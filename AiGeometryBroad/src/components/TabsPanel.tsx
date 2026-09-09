import React, { useState, type ReactElement } from 'react';
import styled from 'styled-components';

// 定义 Tab 组件的 props 接口，假设 Tab 组件会有 title 属性
interface TabProps {
  title: string;
  children?: React.ReactNode;
}

interface TabsPanelProps {
  children: React.ReactNode;
}

const TabsPanel: React.FC<TabsPanelProps> = ({ children }) => {
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  // 将 children 转换为数组，以便安全地遍历和访问
  const childrenArray = React.Children.toArray(children);

  // 如果没有子元素，则不渲染任何内容
  if (childrenArray.length === 0) {
    return null;
  }

  const renderChildPanel = (child: Exclude<React.ReactNode, boolean | null | undefined>, index: number): ReactElement | null => {
    // 确保 child 是一个有效的 React 元素，以便读取 props
    if (!React.isValidElement(child)) {
      return null;
    }
    // 明确指定 child 的类型为 ReactElement<TabProps>
    const typedChild = child as ReactElement<TabProps>;
    return (
      <TabButton
        key={index}
        $isActive={index === activeTabIndex}
        onClick={() => setActiveTabIndex(index)}
      >
        {/* 从子组件的 props 中获取 title */}
        {typedChild.props.title || `Tab ${index + 1}`}
      </TabButton>
    );
  }

  return (
    <TabsPanelContainer>
      {/* --- 页签头部 --- */}
      <TabHeaderContainer>
        {childrenArray.map((child, index) => renderChildPanel(child, index))}
      </TabHeaderContainer>

      {/* --- 页签内容 --- */}
      <TabContentContainer>
        {/* 只渲染当前激活的子组件 */}
        {childrenArray[activeTabIndex]}
      </TabContentContainer>
    </TabsPanelContainer>
  );
};

// --- Styles ---

const TabsPanelContainer = styled.div`
  background-color: #ffffff;
  border-radius: 8px;
  width: 450px;
  flex-shrink: 0;
  
  display: flex;
  flex-direction: column;
  overflow: hidden; /* 确保内部内容不会溢出圆角 */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
`;

const TabHeaderContainer = styled.div`
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid #e5e7eb;
`;

const TabButton = styled.button<{ $isActive: boolean }>`
  flex-grow: 1;
  padding: 0.85rem 1rem;
  font-size: 0.9rem;
  font-weight: 600;
  text-align: center;
  border: none;
  background-color: transparent;
  cursor: pointer;
  color: ${props => (props.$isActive ? '#4f46e5' : '#6b7280')};
  position: relative;
  transition: color 0.2s ease-in-out;

  /* 用伪元素创建激活状态的下划线 */
  &::after {
    content: '';
    position: absolute;
    bottom: -1px; /* 与 header 的 border-bottom 重合 */
    left: 0;
    right: 0;
    height: 2px;
    background-color: #4f46e5;
    transform: scaleX(${props => (props.$isActive ? 1 : 0)});
    transition: transform 0.3s ease-in-out;
  }

  &:hover {
    color: #4f46e5;
  }
`;

const TabContentContainer = styled.div`
  flex-grow: 1;
  /* 关键：让内容区域也能成为 flex 容器，这样其子组件才能正确地 flex-grow */
  display: flex; 
  flex-direction: column;
  padding: 1.5rem;
  overflow-y: auto; /* 如果内容过长，可以滚动 */
  min-height: 0; /* Flexbox 关键修复，允许子元素在空间不足时缩小 */
`;

export default TabsPanel;
