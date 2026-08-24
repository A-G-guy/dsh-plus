/**
 * 登录页：围栏拦截浏览器导航请求时返回的内联 HTML。
 * 自包含（无外部静态资源依赖）、中文、vanilla JS——输入 token → 调
 * /dsh-plus/gate/login → 成功后 reload 放行。
 * @module access-gate/login-page
 */

export function renderLoginPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>访问校验</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #16181d; color: #e6e8ec;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Noto Sans CJK SC", sans-serif;
  }
  .card {
    width: min(92vw, 360px); padding: 32px 28px; border-radius: 14px;
    background: #1e2128; border: 1px solid #2e323c; box-shadow: 0 8px 32px rgba(0,0,0,.4);
    box-sizing: border-box;
  }
  h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
  p { margin: 0 0 22px; font-size: 13px; color: #9aa1ad; line-height: 1.6; }
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
    <h1>此页面受访问控制保护</h1>
    <p>当前网络不在放行名单内。输入访问令牌以继续；或使用名单内的设备/网络访问。</p>
    <input id="token" type="password" placeholder="访问令牌" autocomplete="off" autofocus>
    <button id="btn" type="submit">继续访问</button>
    <div class="msg" id="msg"></div>
  </form>
<script>
  var form = document.getElementById('form');
  var input = document.getElementById('token');
  var btn = document.getElementById('btn');
  var msg = document.getElementById('msg');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var token = input.value;
    if (!token) { msg.className = 'msg err'; msg.textContent = '请输入访问令牌'; return; }
    btn.disabled = true;
    msg.className = 'msg'; msg.textContent = '校验中…';
    fetch('/dsh-plus/gate/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).then(function (res) {
      if (res.ok) { msg.className = 'msg ok'; msg.textContent = '校验通过，正在进入…'; location.reload(); }
      else if (res.status === 429) { msg.className = 'msg err'; msg.textContent = '失败次数过多，请稍后再试'; btn.disabled = false; }
      else { msg.className = 'msg err'; msg.textContent = '令牌无效'; btn.disabled = false; }
    }).catch(function () { msg.className = 'msg err'; msg.textContent = '网络错误，请重试'; btn.disabled = false; });
  });
</script>
</body>
</html>`
}
