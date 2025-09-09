import React from 'react';

// 综合测试各种testID边界情况
const FinalTestComponent = () => {
  const dynamicId = '动态ID变量';
  
  return (
    <>
      {/* 基础格式测试 */}
      <div testID="基础双引号ID">基础测试文本</div>
      <div testID={'基础单引号ID'}>基础单引号文本</div>
      <div testID={`基础模板字符串ID`}>基础模板文本</div>
      <div testID={dynamicId}>动态变量文本</div>
      
      {/* 复杂表达式测试 */}
      <div testID={'复杂' + '拼接' + 'ID'}>复杂拼接文本</div>
      <div testID={`模板${dynamicId}拼接ID`}>模板拼接文本</div>
      
      {/* 对象属性格式测试 */}
      <div style={{testID: '对象样式中的测试ID'}}>对象样式文本</div>
      <div {...{testID: '扩展对象中的测试ID'}}>扩展对象文本</div>
      
      {/* 嵌套和多属性测试 */}
      <div 
        className="test"
        testID="多属性测试ID"
        onClick={() => {}}
        data-test="数据测试属性应该扫描"
      >
        多属性嵌套文本
      </div>
      
      {/* 非testID属性，应该被扫描 */}
      <div data-testid="data-testid应该被扫描">data-testid文本</div>
      <div test-id="test-id应该被扫描">test-id文本</div>
      <div testid="testid应该被扫描">testid文本</div>
      
      {/* 注释中的testID应该被忽略 */}
      {/* <div testID="注释中的testID">注释中的文本</div> */}
      
      {/* 字符串中包含testID关键字但不是属性 */}
      <div title="这个testID不应该影响扫描">包含testID关键字的文本</div>
      
      {/* 普通文本应该正常扫描 */}
      <p>这是普通段落文本</p>
      <span>这是普通span文本</span>
      
      {/* 函数调用中的文本应该正常扫描 */}
      {alert('弹窗消息文本')}
      {console.log('控制台日志文本')}
    </>
  );
};

// 对象定义中的testID测试
const config = {
  testID: '配置对象testID',
  title: '配置对象标题',
  nested: {
    testID: '嵌套对象testID',
    label: '嵌套对象标签'
  }
};

// 类中的testID测试  
class TestClass {
  constructor() {
    this.testID = '类属性testID';
    this.label = '类属性标签';
  }
  
  render() {
    return <div testID="类方法中的testID">类方法渲染文本</div>;
  }
}

export default FinalTestComponent;
