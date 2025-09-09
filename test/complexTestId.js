import React from 'react';
import { Text, View } from 'react-native';

// 测试更复杂的testID场景
function ComplexTestComponent() {
  return (
    <View>
      {/* 嵌套对象中的testID */}
      <Text 
        style={styles.text}
        testID="嵌套测试ID1" 
        accessibilityLabel="可访问性标签"
      >
        正常显示的嵌套文本
      </Text>
      
      {/* 多行JSX中的testID */}
      <Text 
        testID={
          "多行测试ID2"
        }
      >
        多行JSX中的正常文本
      </Text>
      
      {/* 模板字符串作为testID */}
      <Text testID={`模板字符串测试ID3`}>
        模板字符串testID的正常文本
      </Text>
      
      {/* 非testID的属性，应该被扫描 */}
      <Text accessibilityLabel="应该扫描的无障碍标签">
        无障碍相关的正常文本
      </Text>
      
      {/* 动态testID（表达式），字符串部分应被忽略 */}
      <Text testID={"动态测试ID" + "拼接部分"}>
        动态testID的正常文本
      </Text>
    </View>
  );
}

export default ComplexTestComponent;
