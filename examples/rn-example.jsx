// React Native 项目国际化最佳实践示例

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';

// ❌ 扫描前的代码 - 存在多种RN特有场景
const UserProfileScreen = ({ user }) => {
  const handlePress = () => {
    Alert.alert('提示', '确认删除用户？', [
      { text: '取消', style: 'cancel' },
      { text: '确定', onPress: () => console.log('用户已删除') }
    ]);
  };

  return (
    <View style={styles.container}>
      {/* JSX文本 - 会被扫描 */}
      <Text style={styles.title}>用户资料</Text>
      
      {/* testID - 会被忽略 */}
      <Text testID="user-name-text">用户名: {user.name}</Text>
      
      {/* accessibilityLabel - 会被忽略 */}
      <TouchableOpacity 
        accessibilityLabel="编辑用户按钮"
        onPress={handlePress}
      >
        <Text>编辑资料</Text>
      </TouchableOpacity>
      
      {/* 字符串字面量 - 会被扫描 */}
      <Text>{'邮箱: ' + user.email}</Text>
      
      {/* 模板字符串 - 会被扫描 */}
      <Text>{`电话: ${user.phone}`}</Text>
      
      {/* 样式中的字符串 - 不应被替换 */}
      <Text style={{ fontFamily: '苹方-简' }}>状态信息</Text>
    </View>
  );
};

// StyleSheet中的字符串 - 不应被替换
const styles = StyleSheet.create({
  container: {
    flex: 1,
    fontFamily: '苹方-简', // 这种不应该被替换
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  }
});

export default UserProfileScreen;

// ✅ 替换后的代码示例
// import { t } from '../utils/i18n';
// 
// const UserProfileScreen = ({ user }) => {
//   const handlePress = () => {
//     Alert.alert(t('i18n_abc123'), t('i18n_def456'), [
//       { text: t('i18n_cancel'), style: 'cancel' },
//       { text: t('i18n_confirm'), onPress: () => console.log(t('i18n_deleted')) }
//     ]);
//   };
//
//   return (
//     <View style={styles.container}>
//       <Text style={styles.title}>{t('i18n_profile')}</Text>
//       <Text testID="user-name-text">{t('i18n_username', { name: user.name })}</Text>
//       <TouchableOpacity 
//         accessibilityLabel="编辑用户按钮"  // 保持不变
//         onPress={handlePress}
//       >
//         <Text>{t('i18n_edit')}</Text>
//       </TouchableOpacity>
//       <Text>{t('i18n_email_template', { email: user.email })}</Text>
//       <Text>{t('i18n_phone_template', { phone: user.phone })}</Text>
//       <Text style={{ fontFamily: '苹方-简' }}>{t('i18n_status')}</Text>
//     </View>
//   );
// };
