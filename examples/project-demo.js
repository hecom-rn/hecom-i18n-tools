// 示例：实际项目中的使用演示

// 1. 项目初始化时的翻译配置
// src/utils/i18n.js
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// 语言包
import zhTranslations from '../locales/zh.json';
import enTranslations from '../locales/en.json';
import jaTranslations from '../locales/ja.json';

const resources = {
  zh: { translation: zhTranslations },
  en: { translation: enTranslations },
  ja: { translation: jaTranslations },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'zh', // 默认语言
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false,
    },
  });

export const t = (key, options) => i18n.t(key, options);
export default i18n;

// 2. 组件中的使用示例（同步前）
// src/components/UserProfile.jsx
import React from 'react';
import { t } from '../utils/i18n';

function UserProfile({ user }) {
  return (
    <div>
      <h1>用户资料</h1>  {/* 这会被扫描到 */}
      <div className="info">
        <span>用户名: {user.name}</span>  {/* 这会被扫描到 */}
        <span>邮箱地址: {user.email}</span>  {/* 这会被扫描到 */}
        <button>编辑资料</button>  {/* 这会被扫描到 */}
      </div>
      <div className="actions">
        <button>保存修改</button>  {/* 这会被扫描到 */}
        <button>取消操作</button>  {/* 这会被扫描到 */}
      </div>
    </div>
  );
}

export default UserProfile;
