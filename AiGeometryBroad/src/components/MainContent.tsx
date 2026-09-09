import React, { useState, useRef } from 'react';
import styled from 'styled-components';

import TabsPanel from './TabsPanel';
import AIChatPanel from './AIChatPanel';
import ScriptInputPanel from './ScriptInputPanel';
import OutputPanel, { type LogMessage } from './OutputPanel';
import GeometricCanvas from './GeometryCanvas';
import ScriptTreePanel from './ScriptTreePanel';

import { useContainerSize } from '../hooks/useContainerSize';

import { INITIAL_USER_INPUT } from './InitScript';

function MainContent() {

    const [userInput, setUserInput] = useState<string>(INITIAL_USER_INPUT);
    const [generatedScript, setGeneratedScript] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [revision, setRevision] = useState<number>(0);

    const [canvasWrapperRef, canvasDimensions] = useContainerSize<HTMLDivElement>();

    // 创建 state 存储日志消息
    const [logMessages, setLogMessages] = useState<LogMessage[]>([]);
    // 使用 useRef 来为每条消息生成一个唯一的ID，避免不必要的重渲染
    const messageIdCounter = useRef(0);

    // 定义一个用于本地存储的常量键
    const SCRIPT_STORAGE_KEY = 'geo-script-last-code';

    const [script, setScript] = useState<string>(() => {
        const savedScript = localStorage.getItem(SCRIPT_STORAGE_KEY);
        // 如果 localStorage 中有保存的脚本，则使用它，否则使用初始默认脚本
        return savedScript || INITIAL_USER_INPUT;
    });

    const handleExecuteScript = () => {
        localStorage.setItem(SCRIPT_STORAGE_KEY, script);
        setLogMessages([]);
        setGeneratedScript(script);
        setRevision(revision + 1);
    };

    const handleClearOutputMessage = () => {
        setLogMessages([]);
    }

    const handleGeometryMessage = (level: string, line: number, message: string) => {
        const newMessage: LogMessage = {
            id: messageIdCounter.current++,
            level,
            line,
            message
        };
        // 使用函数式更新来安全地追加新消息
        setLogMessages(prevMessages => [...prevMessages, newMessage]);
    }

    return (
        <PageContainer>
            <IntegratedWorkspace>
                <TabsPanel >
                    <ScriptTreePanel title='ScriptFiles'></ScriptTreePanel>
                    <ScriptInputPanel
                        title="Script Input"
                        script={script}
                        onScriptChange={setScript}
                        onExecute={handleExecuteScript}
                    />
                    <AIChatPanel
                        title='AI Chat'
                    />
                </TabsPanel>

                <CanvasWrapper ref={canvasWrapperRef}>
                    {canvasDimensions.width > 0 && canvasDimensions.height > 0 && (
                        <GeometricCanvas
                            width={canvasDimensions.width}
                            height={canvasDimensions.height}
                            script={generatedScript}
                            revision={revision}
                            onGeometryMessage={handleGeometryMessage}
                            onClearMessage={handleClearOutputMessage}
                        />
                    )}
                </CanvasWrapper>

                <OutputPanel title="Output Panel" logs={logMessages} />
            </IntegratedWorkspace>
        </PageContainer>
    );
}

// 页面容器，现在的主要职责是提供背景色并将工作区居中
const PageContainer = styled.div`
  display: flex;
  justify-content: center; /* 水平居中 */
  align-items: center; /* 垂直居中 */
  padding: 2rem; /* 确保工作区与浏览器边缘有边距 */
  
  height: calc(100vh - 80px); /* 假设Header高度为80px */
  width: 100%;
  box-sizing: border-box;
  background-color: #f4f7fc; /* 页面的浅灰色背景 */
`;

// 新增的整合式工作区，这是一个“卡片”
const IntegratedWorkspace = styled.div`
  display: flex;
  align-items: stretch;
  gap: 1.5rem; /* 稍微减小面板间的距离，让它们更紧凑 */
  
  width: 100%;
  max-width: 1700px; /* 设置一个最大宽度，防止在大屏幕上过分拉伸 */
  height: 95%;
  max-height: 1200px; /* 设置一个最大高度 */

  padding: 1.5rem; /* 卡片内部的边距 */
  background-color: #ffffff; /* 卡片使用白色背景 */
  border-radius: 16px; /* 更大的圆角，更柔和 */
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08); /* 更明显的阴影以突出层次感 */
  box-sizing: border-box;
`;

// 中间画布的包裹容器（保持不变）
const CanvasWrapper = styled.div`
  flex-grow: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 0;
  border-radius: 8px;
  background-color: #fafafa; /* 给画布区域一个淡淡的背景色以作区分 */
`;

export default MainContent;