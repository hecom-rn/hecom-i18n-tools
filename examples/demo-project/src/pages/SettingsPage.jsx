import React from 'react';

function SettingsPage() {
  return (
    <div>
      <h2>系统设置</h2>
      <div className="settings">
        <div className="section">
          <h3>账号与安全</h3>
          <button>修改密码</button>
          <button>绑定手机</button>
        </div>
        <div className="section">
          <h3>通知设置</h3>
          <label>
            <input type="checkbox" />
            接收邮件通知
          </label>
        </div>
      </div>
    </div>
  );
}
