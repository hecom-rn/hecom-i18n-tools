import React from 'react';

function UserProfile({ user }) {
  return (
    <div>
      <h1>用户资料</h1>
      <div className="info">
        <span>用户名: {user.name}</span>
        <span>邮箱地址: {user.email}</span>
        <button>编辑资料</button>
      </div>
      <div className="actions">
        <button>保存修改</button>
        <button>取消操作</button>
      </div>
    </div>
  );
}

      <div className="footer">
        <span>最后更新时间</span>
        <button>返回首页</button>
      </div>
