/**
 * token 输入页：围栏拦截未认证浏览器导航时返回的内联 HTML。
 * 自包含（无外部静态资源依赖——静态资产同样受围栏保护）、中文、vanilla JS。
 *
 * 工作方式（与官方 browser-auth 合并后的唯一登录路径）：
 * 用户粘贴当前启动令牌 → fetch `/?token=<令牌>`（同源，跟随 303）→ 官方
 * 交换签发 dsh-auth-* HttpOnly cookie（30 天，按域名:端口分别持有）→
 * 成功后跳回干净 `/`。PWA 内打开本页粘贴一次即可恢复（解决 PWA 无法
 * 携带 ?token= 启动的官方限制）。
 * 本页纯客户端跳转，无服务器端点，令牌校验完全由官方 authorizeIndex 完成。
 * @module access-gate/token-page
 */

export function renderTokenPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 - DeepSeek Harness</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #16181d; color: #e6e8ec;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Noto Sans CJK SC", sans-serif;
  }
  .card {
    width: min(92vw, 420px); padding: 32px 28px; border-radius: 14px;
    background: #1e2128; border: 1px solid #2e323c; box-shadow: 0 8px 32px rgba(0,0,0,.4);
    box-sizing: border-box;
  }
  h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
  p { margin: 0 0 14px; font-size: 13px; color: #9aa1ad; line-height: 1.7; }
  p.tip { margin-bottom: 22px; }
  code {
    padding: 1px 5px; border-radius: 4px; background: #16181d; border: 1px solid #3a3f4b;
    font-size: 12px; color: #c9d1e0; word-break: break-all;
  }
  input {
    width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
    border: 1px solid #3a3f4b; background: #16181d; color: #e6e8ec; font-size: 15px;
    outline: none;
  }
  input:focus { border-color: #5b8cff; }
  button {
    width: 100%; margin-top: 14px; padding: 10px 0; border: 0; border-radius: 8px;
    background: #3d6dff; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
  }
  button:disabled { opacity: .6; cursor: default; }
  .msg { min-height: 18px; margin-top: 12px; font-size: 13px; text-align: center; }
  .err { color: #ff7a76; }
  .ok { color: #63d17c; }
</style>
</head>
<body>
  <form class="card" id="form">
    <h1>需要登录</h1>
    <p>粘贴当前<strong>启动令牌</strong>完成登录。登录后此设备免令牌 30 天（按域名:端口分别持有）。</p>
    <p class="tip">令牌随每次 dsh web 重启更新，获取方式：服务器上执行 <code>dshctl url</code>，或查看启动日志 <code>journalctl -u dsh-web | grep "dsh web:"</code>（链接中 token= 后的部分）。PWA 内打开本页粘贴一次即可恢复。</p>
    <input id="token" type="password" placeholder="启动令牌" autocomplete="off" autofocus>
    <button id="btn" type="submit">登录</button>
    <div class="msg" id="msg"></div>
  </form>
<script>
  var form = document.getElementById('form');
  var input = document.getElementById('token');
  var btn = document.getElementById('btn');
  var msg = document.getElementById('msg');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var token = input.value.trim();
    if (!token) { msg.className = 'msg err'; msg.textContent = '请输入启动令牌'; return; }
    btn.disabled = true;
    msg.className = 'msg'; msg.textContent = '登录中…';
    // 官方令牌交换：同源 fetch 跟随 303，交换响应的 Set-Cookie 由浏览器落罐。
    fetch('/?token=' + encodeURIComponent(token), { redirect: 'follow' })
      .then(function (res) {
        if (res.ok) { msg.className = 'msg ok'; msg.textContent = '登录成功，正在进入…'; location.replace('/'); }
        else if (res.status === 401) { msg.className = 'msg err'; msg.textContent = '令牌无效或已过期（令牌随每次重启更新）'; btn.disabled = false; }
        else { msg.className = 'msg err'; msg.textContent = '登录失败（HTTP ' + res.status + '）'; btn.disabled = false; }
      })
      .catch(function () { msg.className = 'msg err'; msg.textContent = '网络错误，请重试'; btn.disabled = false; });
  });
</script>
</body>
</html>`
}
