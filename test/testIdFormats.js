import React from 'react';
import { Text, View } from 'react-native';

// 测试各种testID格式
function TestComponent() {
  const testValue = '变量测试ID';
  return (
    <View>
      {/* JSX属性格式 - 双引号 */}
      <Text testID="双引号测试ID">正常显示文本1</Text>
      
      {/* JSX属性格式 - 单引号 */}
      <Text testID={'单引号测试ID'}>正常显示文本2</Text>
      
      {/* JSX属性格式 - 变量 */}
      <Text testID={testValue}>正常显示文本3</Text>
      
      {/* 对象属性格式 */}
      <Text style={{ testID: '对象属性测试ID' }}>正常显示文本4</Text>
      
      {/* 对象属性格式 - 不带引号的key */}
      <Text {...{ testID: '对象属性测试ID2' }}>正常显示文本5</Text>
      
      {/* 普通文本 - 应该被扫描 */}
      <Text>这是普通中文文本</Text>
      
      {/* Toast消息 - 应该被扫描 */}
      <Text>{Toast.show('这是Toast消息')}</Text>
    </View>
  );
}

// 对象中的testID
const config = {
  testID: '配置对象中的测试ID',
  title: '配置标题文本'
};

export default TestComponent;
