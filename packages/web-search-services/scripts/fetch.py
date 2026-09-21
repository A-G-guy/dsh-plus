#!/usr/bin/env python3
"""本地优先、无 API 消耗的 URL fetch 脚本。

用于已知 URL 的轻量获取、HTML 正文清理、杂乱信息过滤、基础格式整理和
质量评估。默认不调用任何付费搜索/提取服务，不需要 API Key。

当由 scripts/search.py fetch 调用时，可通过质量阈值让低质量结果触发
Tavily / Exa fallback，以减少不必要的 API fetch 调用费用。
"""

from __future__ import annotations

import argparse
import gzip
import html
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from html.parser import HTMLParser
from typing import Any, Dict, Optional

try:
    from env_loader import load_env_file

    load_env_file()
except Exception:
    # 本地 fetch 不应因为私有 env 文件异常而失效；显式环境变量仍可直接生效。
    pass


# 默认使用常见浏览器 UA，减少部分站点因非浏览器 UA 直接拒绝本地抓取的概率。
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 pi-search-services-skill/local-fetch"
)
DEFAULT_QUALITY_THRESHOLD = 0.30
RETRY_STATUSES = {408, 425, 429, 500, 502, 503, 504}
TEXT_CONTENT_TYPES = {
    "application/atom+xml",
    "application/javascript",
    "application/json",
    "application/ld+json",
    "application/rss+xml",
    "application/xhtml+xml",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "text/csv",
    "text/html",
    "text/markdown",
    "text/plain",
    "text/xml",
}


class LowQualityError(RuntimeError):
    """本地 fetch 失败或质量不足，可由上层用于触发 API fallback。"""

    def __init__(self, failures: list[Dict[str, Any]], result: Dict[str, Any]):
        self.failures = failures
        self.result = result
        self.details = {"failures": failures, "qualityFailures": failures}
        summary = "; ".join(
            f"{item.get('url')}: {item.get('reason')} (score={item.get('score')})"
            for item in failures[:3]
        )
        if len(failures) > 3:
            summary += f"; ... 共 {len(failures)} 个失败/低质量 URL"
        super().__init__(f"本地 fetch 返回失败或质量不足：{summary}")


class ReadableHTMLParser(HTMLParser):
    """将常见 HTML 转成可读文本，尽量丢弃脚本、样式、导航等噪声。"""

    BLOCK_TAGS = {
        "address", "article", "aside", "blockquote", "br", "dd", "details", "dialog",
        "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
        "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav",
        "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
    }
    SKIP_TAGS = {"script", "style", "noscript", "svg", "canvas", "iframe", "template"}
    STRUCTURAL_NOISE_TAGS = {"nav", "footer", "header", "aside", "form"}

    def __init__(self, *, keep_links: bool = False, drop_structural_noise: bool = True) -> None:
        super().__init__(convert_charrefs=True)
        self.keep_links = keep_links
        self.drop_structural_noise = drop_structural_noise
        self.parts: list[str] = []
        self.title_parts: list[str] = []
        self.meta_description = ""
        self._skip_depth = 0
        self._title_depth = 0
        self._link_href: Optional[str] = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        tag = tag.lower()
        attrs_dict = {k.lower(): v for k, v in attrs if k}
        if tag == "title":
            self._title_depth += 1
        if tag == "meta":
            name = (attrs_dict.get("name") or attrs_dict.get("property") or "").lower()
            if name in {"description", "og:description"} and attrs_dict.get("content") and not self.meta_description:
                self.meta_description = attrs_dict["content"] or ""
        if tag in self.SKIP_TAGS or (self.drop_structural_noise and tag in self.STRUCTURAL_NOISE_TAGS):
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag in self.BLOCK_TAGS:
            self.parts.append("\n")
        if tag == "a" and self.keep_links:
            self._link_href = attrs_dict.get("href")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title" and self._title_depth:
            self._title_depth -= 1
        if tag in self.SKIP_TAGS or (self.drop_structural_noise and tag in self.STRUCTURAL_NOISE_TAGS):
            if self._skip_depth:
                self._skip_depth -= 1
            return
        if self._skip_depth:
            return
        if tag == "a" and self.keep_links and self._link_href:
            self.parts.append(f" ({self._link_href})")
            self._link_href = None
        if tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._title_depth:
            self.title_parts.append(data)
            return
        if self._skip_depth:
            return
        if data and data.strip():
            self.parts.append(data)

    @property
    def title(self) -> str:
        return normalize_inline(" ".join(self.title_parts))

    @property
    def text(self) -> str:
        return "".join(self.parts)


def normalize_inline(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def normalize_text(value: str) -> str:
    value = html.unescape(value or "")
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    # 保留段落边界，但压缩行内空白。
    lines = [re.sub(r"[\t \f\v]+", " ", line).strip() for line in value.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def filter_noise_lines(text: str, *, min_line_chars: int = 2) -> str:
    """过滤重复行和常见站点噪声。"""

    noise_patterns = [
        r"^(skip to|jump to)\b",
        r"^(sign in|log in|login|register|subscribe|advertisement)$",
        r"^(accept|reject|manage) (all )?(cookies|cookie settings)\b",
        r"^(privacy policy|terms of service|cookie policy)$",
        r"^(share|tweet|follow us|copyright)\b",
        r"^©\s?\d{4}",
        r"^\s*[·•|]+\s*$",
    ]
    compiled = [re.compile(p, re.I) for p in noise_patterns]
    seen: set[str] = set()
    kept: list[str] = []
    blank_pending = False
    for raw_line in text.split("\n"):
        line = raw_line.strip()
        if not line:
            if kept:
                blank_pending = True
            continue
        if len(line) < min_line_chars:
            continue
        compact = re.sub(r"\W+", "", line.lower())
        if compact and compact in seen:
            continue
        if any(p.search(line) for p in compiled):
            continue
        # 菜单/标签云常见特征：短词密集且无句子结构。
        words = line.split()
        if len(words) > 10 and sum(1 for word in words if len(word) <= 2) / max(len(words), 1) > 0.55:
            continue
        if blank_pending:
            kept.append("")
            blank_pending = False
        kept.append(line)
        if compact:
            seen.add(compact)
    return "\n".join(kept).strip()


def to_markdownish(text: str) -> str:
    """做轻量格式整理，不试图完整还原网页结构。"""

    lines = text.split("\n")
    out: list[str] = []
    previous_blank = True
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if out and out[-1] != "":
                out.append("")
            previous_blank = True
            continue
        words = stripped.split()
        # 常见标题行：较短、位于段落边界、无句末标点、不是按钮/导航式极短词。
        looks_heading = (
            previous_blank
            and 4 <= len(stripped) <= 90
            and len(words) <= 12
            and not re.search(r"[。.!?！？:：,，;；]$", stripped)
            and not re.fullmatch(r"[\w\-_/ ]{1,20}", stripped, re.I)
        )
        if looks_heading:
            if out and out[-1] != "":
                out.append("")
            out.append(f"## {stripped}")
        else:
            out.append(stripped)
        previous_blank = False
    return "\n".join(out).strip()


def _decompress_body(raw: bytes, content_encoding: str) -> bytes:
    encoding = (content_encoding or "").lower()
    if "gzip" in encoding:
        try:
            return gzip.decompress(raw)
        except OSError:
            return raw
    if "deflate" in encoding:
        try:
            return zlib.decompress(raw)
        except zlib.error:
            try:
                return zlib.decompress(raw, -zlib.MAX_WBITS)
            except zlib.error:
                return raw
    return raw


def _detect_charset(raw: bytes, content_type: str) -> str:
    """从 HTTP 头部或 HTML meta 标签检测字符集。"""

    match = re.search(r"charset=([^;]+)", content_type or "", re.I)
    if match:
        return match.group(1).strip(' "\'').lower()

    head = raw[:8192]
    meta_match = re.search(rb"<meta[^>]+charset\s*=\s*['\"]?\s*([a-zA-Z0-9._-]+)", head, re.I)
    if meta_match:
        return meta_match.group(1).decode("ascii", "ignore").lower()

    equiv_match = re.search(rb"<meta[^>]+http-equiv\s*=\s*['\"]?content-type['\"]?[^>]+>", head, re.I)
    if equiv_match:
        content_match = re.search(rb"charset\s*=\s*([a-zA-Z0-9._-]+)", equiv_match.group(0), re.I)
        if content_match:
            return content_match.group(1).decode("ascii", "ignore").lower()

    return "utf-8"


def decode_body(raw: bytes, headers: Any) -> str:
    raw = _decompress_body(raw, headers.get("content-encoding", ""))
    content_type = headers.get("content-type", "")
    charset = _detect_charset(raw, content_type)
    candidates = [charset, "utf-8", "gb18030", "big5", "shift_jis", "latin-1"]
    seen: set[str] = set()
    best_text = ""
    best_replacements: Optional[int] = None
    for encoding in candidates:
        if not encoding or encoding in seen:
            continue
        seen.add(encoding)
        try:
            text = raw.decode(encoding, "replace")
        except LookupError:
            continue
        replacements = text.count("\ufffd")
        if best_replacements is None or replacements < best_replacements:
            best_text = text
            best_replacements = replacements
        if replacements == 0:
            return text
    return best_text or raw.decode("utf-8", "replace")


def _is_text_content_type(content_type: str) -> bool:
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    return mime.startswith("text/") or mime in TEXT_CONTENT_TYPES or mime.endswith("+json") or mime.endswith("+xml")


def _looks_like_text(raw: bytes) -> bool:
    if not raw:
        return True
    sample = raw[:4096]
    if b"\x00" in sample:
        return False
    decoded = sample.decode("utf-8", "replace")
    replacement_ratio = decoded.count("\ufffd") / max(len(decoded), 1)
    control_chars = sum(1 for ch in decoded if ord(ch) < 32 and ch not in "\n\r\t")
    return replacement_ratio < 0.20 and control_chars / max(len(decoded), 1) < 0.05


def parse_header_list(values: Optional[list[str]]) -> Dict[str, str]:
    """解析 CLI 传入的 Header 列表，格式为 `Key: Value`。"""

    headers: Dict[str, str] = {}
    for raw in values or []:
        if ":" not in raw:
            raise ValueError(f"非法 header（缺少冒号）: {raw}")
        key, value = raw.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            raise ValueError(f"非法 header（key 为空）: {raw}")
        if re.search(r"[\r\n]", key + value):
            raise ValueError("非法 header：不允许包含换行")
        headers[key] = value
    return headers


def normalize_proxy_url(proxy: Optional[str]) -> Optional[str]:
    """规范化代理地址；支持 127.0.0.1:7890 这类简写。"""

    value = (proxy or os.getenv("FETCH_PROXY") or os.getenv("LOCAL_FETCH_PROXY") or "").strip()
    if not value:
        return None
    if "://" not in value:
        value = f"http://{value}"
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"本地 fetch 仅支持 http/https 代理，不支持: {parsed.scheme}")
    if not parsed.hostname or not parsed.port:
        raise ValueError(f"非法代理地址: {proxy}")
    return value


def _bounded_retry_settings(
    retries: Optional[int],
    retry_delay: Optional[float],
    retry_jitter: float,
) -> tuple[int, float, float, float]:
    """返回有上限的重试设置，避免单次 fetch 长时间卡死。"""

    env_retries = int(os.getenv("FETCH_RETRIES") or "1")
    max_retries = env_retries if retries is None else max(0, retries)
    max_retries = min(max_retries, int(os.getenv("FETCH_MAX_RETRIES") or "4"))
    delay = float(os.getenv("FETCH_RETRY_DELAY") or "0.75") if retry_delay is None else max(0.0, retry_delay)
    delay = min(delay, float(os.getenv("FETCH_RETRY_DELAY_CAP") or "10"))
    jitter = min(max(0.0, retry_jitter), float(os.getenv("FETCH_RETRY_JITTER_CAP") or "5"))
    max_delay = float(os.getenv("FETCH_RETRY_MAX_DELAY") or "8")
    return max_retries, delay, jitter, max_delay


def _retry_sleep_seconds(delay: float, jitter: float, max_delay: float, attempt: int) -> float:
    return min(max_delay, delay * (1.6 ** attempt) + random.uniform(0, jitter))


def _extract_with_bs4(
    body: str,
    *,
    keep_links: bool = False,
    drop_structural_noise: bool = True,
) -> Optional[tuple[str, str, str]]:
    """优先用 bs4/lxml 做更稳的正文抽取；不可用时返回 None。"""

    try:
        from bs4 import BeautifulSoup  # type: ignore
    except Exception:
        return None

    try:
        soup = BeautifulSoup(body, "lxml")
    except Exception:
        soup = BeautifulSoup(body, "html.parser")

    for tag in soup(["script", "style", "noscript", "svg", "canvas", "iframe", "template"]):
        tag.decompose()
    if drop_structural_noise:
        for selector in ["nav", "footer", "header", "aside", "form"]:
            for tag in soup.select(selector):
                tag.decompose()
    if keep_links:
        for tag in soup.find_all("a"):
            href = tag.get("href")
            if href and tag.get_text(strip=True):
                tag.append(f" ({href})")

    title = normalize_inline(soup.title.get_text(" ") if soup.title else "")
    meta = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
    description = normalize_inline(meta.get("content", "") if meta else "")
    root = None
    for selector in ["main", "article", "[role='main']", ".content", "#content", ".post", ".entry-content"]:
        root = soup.select_one(selector)
        if root:
            break
    if root is None:
        root = soup.body or soup
    text = root.get_text("\n")
    return title, description, text


def _extract_html_text(
    body: str,
    *,
    keep_links: bool = False,
    drop_structural_noise: bool = True,
    extract_mode: str = "auto",
) -> tuple[str, str, str]:
    if extract_mode in {"auto", "bs4"}:
        extracted = _extract_with_bs4(body, keep_links=keep_links, drop_structural_noise=drop_structural_noise)
        if extracted is not None:
            return extracted
        if extract_mode == "bs4":
            # bs4 不可用时仍退回内置 parser，保持脚本可用。
            pass
    parser = ReadableHTMLParser(keep_links=keep_links, drop_structural_noise=drop_structural_noise)
    parser.feed(body)
    return parser.title, normalize_inline(parser.meta_description), parser.text


def extract_readable_text(
    body: str,
    *,
    content_type: str,
    keep_links: bool = False,
    drop_structural_noise: bool = True,
    markdownish: bool = True,
    extract_mode: str = "auto",
) -> tuple[str, str, str]:
    """返回 title, description, cleaned_text。"""

    lower_type = content_type.lower()
    if "html" in lower_type or "<html" in body[:1000].lower() or "<!doctype html" in body[:1000].lower():
        title, description, raw_text = _extract_html_text(
            body,
            keep_links=keep_links,
            drop_structural_noise=drop_structural_noise,
            extract_mode=extract_mode,
        )
        text = normalize_text(raw_text)
    else:
        title = ""
        description = ""
        text = normalize_text(body)
    text = filter_noise_lines(text)
    if markdownish:
        text = to_markdownish(text)
    return title, description, text


def assess_quality(result: Dict[str, Any], *, threshold: float = DEFAULT_QUALITY_THRESHOLD) -> Dict[str, Any]:
    """评估本地 fetch 结果质量，用于决定是否需要付费/API 或 Playwright fallback。"""

    reasons: list[str] = []
    suggestions: list[str] = []
    flags: Dict[str, bool] = {
        "requestFailed": False,
        "tooShort": False,
        "jsRequired": False,
        "blocked": False,
        "soft404": False,
        "encodingIssue": False,
        "lowSentenceDensity": False,
        "lowDiversity": False,
    }
    text = result.get("text") or ""
    title = result.get("title") or ""
    combined = f"{title}\n{text}".lower()
    characters = len(text)
    score = 0.55

    if not result.get("ok"):
        score -= 0.55
        flags["requestFailed"] = True
        reasons.append(result.get("error") or "请求失败")
    is_html = "html" in (result.get("contentType") or "").lower()
    is_rendered = bool(result.get("rendered"))
    if characters == 0:
        score -= 0.45
        flags["tooShort"] = True
        if result.get("ok") and is_html and not is_rendered:
            flags["jsRequired"] = True
            reasons.append("HTML 正文为空，可能依赖 JS 动态渲染")
        else:
            reasons.append("正文为空")
    elif characters < 80:
        score -= 0.35
        flags["tooShort"] = True
        if result.get("ok") and is_html and not is_rendered:
            flags["jsRequired"] = True
            reasons.append("HTML 正文过短，可能依赖 JS 动态渲染")
        else:
            reasons.append("正文过短")
    elif characters < 120:
        score -= 0.20 if title else 0.28
        flags["tooShort"] = True
        if result.get("ok") and is_html and not is_rendered:
            flags["jsRequired"] = True
            reasons.append("HTML 正文偏短，可能依赖 JS 动态渲染")
        else:
            reasons.append("正文偏短")
    elif characters < 400:
        score -= 0.12
        reasons.append("正文偏短")
    elif characters > 1000:
        score += 0.08

    if title:
        score += 0.04
    elif "html" in (result.get("contentType") or "").lower():
        score -= 0.04
        reasons.append("缺少标题")

    js_patterns = [
        r"please enable (javascript|js)",
        r"browser is not supported",
        r"javascript (is )?(disabled|required)",
        r"enable javascript",
    ]
    blocked_patterns = [
        r"enable cookies",
        r"checking (your )?browser",
        r"checking if the site connection is secure",
        r"just a moment",
        r"cloudflare",
        r"captcha",
        r"access denied",
        r"verify you are human",
        r"unusual traffic",
        r"bot detection",
        r"login required",
    ]
    if any(re.search(pattern, combined, re.I) for pattern in js_patterns):
        score -= 0.45
        flags["jsRequired"] = True
        reasons.append("疑似 JS 动态渲染页面")
    if any(re.search(pattern, combined, re.I) for pattern in blocked_patterns):
        score -= 0.45
        flags["blocked"] = True
        reasons.append("疑似验证码/反爬/登录拦截页")

    error_patterns = [
        r"\b404\b",
        r"page not found",
        r"not found",
        r"\b403\b",
        r"forbidden",
        r"unauthorized",
        r"internal server error",
        r"service unavailable",
    ]
    if any(re.search(pattern, combined, re.I) for pattern in error_patterns):
        score -= 0.30
        flags["soft404"] = True
        reasons.append("疑似错误页或软 404")

    if result.get("truncated") and characters < 300:
        score -= 0.10
        reasons.append("内容被截断且有效正文偏少")

    if text:
        replacement_ratio = text.count("\ufffd") / max(characters, 1)
        if replacement_ratio > 0.01:
            score -= 0.25
            flags["encodingIssue"] = True
            reasons.append("疑似字符编码错误")
        sentence_marks = len(re.findall(r"[。.!?！？]", text))
        line_count = max(len([line for line in text.split("\n") if line.strip()]), 1)
        if characters > 400 and sentence_marks / line_count < 0.15:
            score -= 0.10
            flags["lowSentenceDensity"] = True
            reasons.append("正文句子密度偏低")
        unique_ratio = len(set(text)) / max(characters, 1)
        if characters > 300 and unique_ratio < 0.04:
            score -= 0.20
            flags["lowDiversity"] = True
            reasons.append("字符多样性异常低")

    if flags["jsRequired"]:
        suggestions.append("try --with-js 或保持默认自动 Playwright 以渲染动态页面")
    if flags["blocked"]:
        suggestions.append("可尝试 --with-js、--referer、--header 或降低请求频率；若仍失败再 fallback 到 Tavily/Exa")
    if flags["encodingIssue"]:
        suggestions.append("可检查页面 charset 或尝试 --extract-mode parser/bs4")
    if flags["tooShort"] and not flags["jsRequired"]:
        suggestions.append("可提高 --max-characters 或启用 Playwright/服务端 fetch fallback")

    score = max(0.0, min(1.0, round(score, 3)))
    return {
        "score": score,
        "threshold": threshold,
        "pass": score >= threshold,
        "reason": "；".join(reasons) if reasons else "质量可接受",
        "reasons": reasons,
        "flags": flags,
        "suggestions": suggestions,
    }


def _failure_result(url: str, *, error: str, status: Optional[int] = None, content_type: str = "", attempts: Optional[list[Dict[str, Any]]] = None) -> Dict[str, Any]:
    result: Dict[str, Any] = {"ok": False, "url": url, "error": error}
    if status is not None:
        result["status"] = status
    if content_type:
        result["contentType"] = content_type
    if attempts:
        result["attempts"] = attempts
    return result


def fetch_one(
    url: str,
    *,
    timeout: Optional[float] = None,
    max_chars: int = 20000,
    keep_links: bool = False,
    drop_structural_noise: bool = True,
    markdownish: bool = True,
    user_agent: Optional[str] = None,
    retries: Optional[int] = None,
    retry_delay: Optional[float] = None,
    retry_jitter: float = 0.0,
    retry_on_any: bool = False,
    referer: Optional[str] = None,
    accept_language: Optional[str] = None,
    extra_headers: Optional[Dict[str, str]] = None,
    extract_mode: str = "auto",
    proxy: Optional[str] = None,
) -> Dict[str, Any]:
    headers = {
        "User-Agent": user_agent or os.getenv("FETCH_USER_AGENT") or DEFAULT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml,application/json,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": accept_language or os.getenv("FETCH_ACCEPT_LANGUAGE") or "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if referer:
        headers["Referer"] = referer
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers)
    timeout = timeout or float(os.getenv("SEARCH_TIMEOUT") or os.getenv("FETCH_TIMEOUT") or "30")
    max_retries, retry_delay, retry_jitter, retry_max_delay = _bounded_retry_settings(retries, retry_delay, retry_jitter)
    proxy_url = normalize_proxy_url(proxy)
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url} if proxy_url else {})
    )
    attempts: list[Dict[str, Any]] = []

    for attempt in range(max_retries + 1):
        try:
            with opener.open(req, timeout=timeout) as resp:
                content_type = resp.headers.get("content-type", "")
                raw = resp.read(max_chars * 4 + 65536)
                body_probe = raw[:4096].lower()
                looks_html = b"<html" in body_probe or b"<!doctype html" in body_probe
                if not (_is_text_content_type(content_type) or looks_html or _looks_like_text(raw)):
                    return _failure_result(
                        resp.geturl(),
                        status=resp.status,
                        content_type=content_type,
                        error="非文本内容，跳过正文清理",
                        attempts=attempts or None,
                    )
                body = decode_body(raw, resp.headers)
                title, description, cleaned = extract_readable_text(
                    body,
                    content_type=content_type,
                    keep_links=keep_links,
                    drop_structural_noise=drop_structural_noise,
                    markdownish=markdownish,
                    extract_mode=extract_mode,
                )
                truncated = len(cleaned) > max_chars
                if truncated:
                    cleaned = cleaned[:max_chars].rstrip()
                return {
                    "ok": True,
                    "url": resp.geturl(),
                    "status": resp.status,
                    "contentType": content_type,
                    "title": title,
                    "description": description,
                    "text": cleaned,
                    "truncated": truncated,
                    "characters": len(cleaned),
                    "attempts": attempts or None,
                    "proxy": proxy_url,
                }
        except urllib.error.HTTPError as exc:
            attempt_info = {"attempt": attempt + 1, "status": exc.code, "error": f"HTTP {exc.code}: {exc.reason}"}
            attempts.append(attempt_info)
            if (retry_on_any or exc.code in RETRY_STATUSES) and attempt < max_retries:
                time.sleep(_retry_sleep_seconds(retry_delay, retry_jitter, retry_max_delay, attempt))
                continue
            return _failure_result(url, status=exc.code, error=f"HTTP {exc.code}: {exc.reason}", attempts=attempts)
        except urllib.error.URLError as exc:
            attempt_info = {"attempt": attempt + 1, "error": str(exc.reason)}
            attempts.append(attempt_info)
            if attempt < max_retries:
                time.sleep(_retry_sleep_seconds(retry_delay, retry_jitter, retry_max_delay, attempt))
                continue
            return _failure_result(url, error=str(exc.reason), attempts=attempts)
    return _failure_result(url, error="未知 fetch 失败", attempts=attempts)


def fetch_urls(
    urls: list[str],
    *,
    timeout: Optional[float] = None,
    max_chars: int = 20000,
    keep_links: bool = False,
    drop_structural_noise: bool = True,
    markdownish: bool = True,
    user_agent: Optional[str] = None,
    min_quality_score: Optional[float] = None,
    retries: Optional[int] = None,
    retry_delay: Optional[float] = None,
    retry_jitter: float = 0.0,
    retry_on_any: bool = False,
    referer: Optional[str] = None,
    accept_language: Optional[str] = None,
    extra_headers: Optional[Dict[str, str]] = None,
    extract_mode: str = "auto",
    proxy: Optional[str] = None,
) -> Dict[str, Any]:
    threshold = DEFAULT_QUALITY_THRESHOLD if min_quality_score is None else min_quality_score
    results = [
        fetch_one(
            url,
            timeout=timeout,
            max_chars=max_chars,
            keep_links=keep_links,
            drop_structural_noise=drop_structural_noise,
            markdownish=markdownish,
            user_agent=user_agent,
            retries=retries,
            retry_delay=retry_delay,
            retry_jitter=retry_jitter,
            retry_on_any=retry_on_any,
            referer=referer,
            accept_language=accept_language,
            extra_headers=extra_headers,
            extract_mode=extract_mode,
            proxy=proxy,
        )
        for url in urls
    ]
    failures: list[Dict[str, Any]] = []
    for item in results:
        quality = assess_quality(item, threshold=threshold)
        item["quality"] = quality
        if min_quality_score is not None and (not item.get("ok") or quality["score"] < threshold):
            failures.append({
                "url": item.get("url"),
                "status": item.get("status"),
                "score": quality["score"],
                "threshold": threshold,
                "reason": quality["reason"],
                "flags": quality.get("flags"),
                "suggestions": quality.get("suggestions"),
                "error": item.get("error"),
            })

    result = {
        "ok": any(item.get("ok") for item in results),
        "allOk": all(item.get("ok") for item in results) if results else False,
        "service": "local-fetch",
        "data": {"results": results},
    }
    if min_quality_score is not None:
        result["qualityThreshold"] = threshold
        result["qualityPass"] = not failures
        if failures:
            result["qualityFailures"] = failures
            raise LowQualityError(failures, result)
    return result


def split_csv(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def result_to_markdown(result: Dict[str, Any]) -> str:
    chunks: list[str] = []
    if result.get("error"):
        chunks.extend([f"> {result['error']}", ""])
    for item in result.get("data", {}).get("results", []):
        chunks.append(f"# {item.get('title') or item.get('url')}")
        chunks.append("")
        chunks.append(f"- URL: {item.get('url')}")
        if item.get("status"):
            chunks.append(f"- Status: {item.get('status')}")
        if item.get("contentType"):
            chunks.append(f"- Content-Type: {item.get('contentType')}")
        if item.get("description"):
            chunks.append(f"- Description: {item.get('description')}")
        if item.get("quality"):
            quality = item["quality"]
            chunks.append(f"- Quality: {quality.get('score')} / {quality.get('threshold')} ({quality.get('reason')})")
            if quality.get("suggestions"):
                chunks.append(f"- Suggestions: {'; '.join(quality.get('suggestions') or [])}")
        if item.get("error"):
            chunks.append(f"- Error: {item.get('error')}")
        chunks.append("")
        if item.get("text"):
            chunks.append(item["text"])
        chunks.append("")
    return "\n".join(chunks).strip()


def result_to_summary(result: Dict[str, Any], *, max_snippet: int = 240) -> str:
    chunks: list[str] = []
    for item in result.get("data", {}).get("results", []):
        quality = item.get("quality") or {}
        text = re.sub(r"\s+", " ", item.get("text") or "").strip()
        if len(text) > max_snippet:
            text = text[:max_snippet].rstrip() + "…"
        chunks.append(f"- {item.get('title') or item.get('url')}")
        chunks.append(f"  URL: {item.get('url')}")
        if item.get("status"):
            chunks.append(f"  Status: {item.get('status')}")
        if quality:
            chunks.append(f"  Quality: {quality.get('score')} / {quality.get('threshold')} ({quality.get('reason')})")
        if item.get("description"):
            chunks.append(f"  Description: {item.get('description')}")
        if item.get("error"):
            chunks.append(f"  Error: {item.get('error')}")
        if text:
            chunks.append(f"  Snippet: {text}")
    return "\n".join(chunks).strip()


def _sort_result_by_quality(result: Dict[str, Any]) -> None:
    results = result.get("data", {}).get("results")
    if isinstance(results, list):
        results.sort(key=lambda item: (item.get("quality") or {}).get("score", -1), reverse=True)


def _write_output(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)
        if content and not content.endswith("\n"):
            fh.write("\n")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="本地优先 fetch：抓取 URL、清理 HTML 噪声、质量评估、整理为 JSON/Markdown/Text")
    parser.add_argument("--urls", required=True, help="逗号分隔 URL")
    parser.add_argument("--timeout", type=float)
    parser.add_argument("--max-characters", type=int, default=20000)
    parser.add_argument("--keep-links", action="store_true", help="保留 a 标签链接")
    parser.add_argument("--keep-structural-noise", action="store_true", help="不丢弃 nav/header/footer/aside/form")
    parser.add_argument("--plain", action="store_true", help="不做标题式 markdown 整理")
    parser.add_argument("--user-agent")
    parser.add_argument("--accept-language", help="覆盖 Accept-Language")
    parser.add_argument("--referer", help="设置 Referer 请求头")
    parser.add_argument("--proxy", help="本地 fetch 代理地址，如 127.0.0.1:7890 或 http://127.0.0.1:7890；不影响 Tavily/Exa/Context7 API")
    parser.add_argument("--header", action="append", help="追加自定义请求头，格式：'Key: Value'；可重复")
    parser.add_argument("--extract-mode", choices=["auto", "parser", "bs4"], default="auto", help="HTML 正文抽取模式；auto 优先 bs4/lxml，失败退回内置 parser")
    parser.add_argument("--retries", type=int, help="失败重试次数；默认读取 FETCH_RETRIES 或 1")
    parser.add_argument("--retry-delay", type=float, help="重试初始等待秒数；默认读取 FETCH_RETRY_DELAY 或 0.75")
    parser.add_argument("--retry-jitter", type=float, default=0.0, help="每次重试额外随机等待上限秒数")
    parser.add_argument("--retry-on-any", action="store_true", help="对任意 HTTP 错误码也重试，而不只重试 408/429/5xx")
    parser.add_argument("--min-quality", type=float, help="质量评分阈值（0-1）；低于阈值时退出码为 1，供上层 fallback")
    parser.add_argument("--summary", action="store_true", help="输出摘要视图")
    parser.add_argument("--sort-by-quality", action="store_true", help="多 URL 时按质量评分降序输出")
    parser.add_argument("--output-file", help="把结果写入文件；stdout 只输出简短状态")
    parser.add_argument("--format", choices=["json", "markdown", "text"], default="json")
    args = parser.parse_args(argv)

    exit_code = 0
    try:
        result = fetch_urls(
            split_csv(args.urls),
            timeout=args.timeout,
            max_chars=args.max_characters,
            keep_links=args.keep_links,
            drop_structural_noise=not args.keep_structural_noise,
            markdownish=not args.plain,
            user_agent=args.user_agent,
            min_quality_score=args.min_quality,
            retries=args.retries,
            retry_delay=args.retry_delay,
            retry_jitter=args.retry_jitter,
            retry_on_any=args.retry_on_any,
            referer=args.referer,
            accept_language=args.accept_language,
            extra_headers=parse_header_list(args.header),
            extract_mode=args.extract_mode,
            proxy=args.proxy,
        )
    except LowQualityError as exc:
        result = exc.result
        result["ok"] = False
        result["error"] = str(exc)
        exit_code = 1

    if args.sort_by_quality:
        _sort_result_by_quality(result)

    if args.format == "json":
        output = json.dumps(result, ensure_ascii=False, indent=2)
    elif args.format == "markdown":
        output = result_to_summary(result) if args.summary else result_to_markdown(result)
    else:
        output = result_to_summary(result) if args.summary else "\n\n".join(item.get("text", "") for item in result.get("data", {}).get("results", []))

    if args.output_file:
        _write_output(args.output_file, output)
        print(json.dumps({"ok": result.get("ok"), "outputFile": args.output_file, "service": result.get("service")}, ensure_ascii=False))
    else:
        print(output)
    return exit_code if exit_code else (0 if result.get("ok") else 1)


if __name__ == "__main__":
    sys.exit(main())
