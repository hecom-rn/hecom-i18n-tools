// 测试 Sentry.captureMessage 忽略逻辑
import React from 'react';

function SentryTest() {
  Sentry.captureMessage('这是Sentry的错误消息');
  console.log('这是普通控制台日志');
  UnionLog.error('这是UnionLog的错误');
  return <div>页面正常文案</div>;
}

export default SentryTest;
