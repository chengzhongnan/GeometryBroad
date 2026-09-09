import React, { useState, useMemo } from 'react';
import styled, { css } from 'styled-components';

export interface LogMessage {
  id: number;
  level: string;
  line?: number;
  message: string;
}

// 1. 让 props 接收 title
interface OutputPanelProps {
  title: string;
  logs: LogMessage[];
}

const OutputPanel: React.FC<OutputPanelProps> = ({ title, logs }) => {
  // ... 内部逻辑和 state 保持不变
  const [showLevel, setShowLevel] = useState(false);
  const [showLine, setShowLine] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');

  const availableLevels = useMemo(() => {
    const levels = new Set(logs.map(log => log.level));
    return ['all', ...levels];
  }, [logs]);

  const filteredLogs = useMemo(() => {
    if (activeFilter === 'all') {
      return logs;
    }
    return logs.filter(log => log.level === activeFilter);
  }, [logs, activeFilter]);


  return (
    // 2. LogContainer 现在是真正的“面板”容器了
    <PanelContainer>
      {/* 3. 在这里渲染标题 */}
      <PanelTitle>{title}</PanelTitle>
      <ControlsContainer>
        {/* <FilterGroup>
          {availableLevels.map(level => (
            <FilterButton
              key={level}
              $isActive={activeFilter === level}
              onClick={() => setActiveFilter(level)}
            >
              {level}
            </FilterButton>
          ))}
        </FilterGroup> */}

        <FilterGroup>
          <ToggleWrapper>
            <input
              type="checkbox"
              id="showLevelToggle"
              checked={showLevel}
              onChange={() => setShowLevel(prev => !prev)}
            />
            <label htmlFor="showLevelToggle">level</label>
          </ToggleWrapper>
          <ToggleWrapper>
            <input
              type="checkbox"
              id="showLineToggle"
              checked={showLine}
              onChange={() => setShowLine(prev => !prev)}
            />
            <label htmlFor="showLineToggle">line</label>
          </ToggleWrapper>
        </FilterGroup>
      </ControlsContainer>
      
      <LogList>
        {filteredLogs.map(log => (
          <LogLine key={log.id} $level={log.level}>
            {showLevel && <LogLevel $level={log.level}>[{log.level.toUpperCase()}]</LogLevel>}
            {showLine && log.line != null && <LineNumber>L{log.line}:</LineNumber>}
            <Message>{log.message}</Message>
          </LogLine>
        ))}
      </LogList>
    </PanelContainer>
  );
};

// --- Styles ---

// 4. 将原 Panel 的样式和 LogContainer 的样式合并
const PanelContainer = styled.div`
  /* 来自原 Panel 的样式 */
  background-color: #ffffff; /* 通常面板有自己的背景 */
  border-radius: 8px;
  width: 300px; /* 您可以按需设置宽度 */
  flex-shrink: 0;

  /* 来自原 LogContainer 的样式 */
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* 关键：确保此容器不滚动 */
  
  /* 添加自己的背景色以和画布区分 */
  background-color: #2d3436;
  color: #dfe6e9;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.9rem;
`;

// 5. 新增 PanelTitle 样式
const PanelTitle = styled.h2`
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: #7f8c8d;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0; /* 标题不压缩 */
`;

const ControlsContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid #4b5563;
  flex-shrink: 0;
`;

const LogList = styled.div`
  flex-grow: 1; /* 占据所有剩余空间 */
  overflow-y: auto; /* 内容溢出时出现滚动条 */
  padding-right: 0.5rem;
  min-height: 0; /* Flexbox 关键修复：允许子元素在空间不足时缩小 */
`;


// ... 其余所有样式 (FilterGroup, FilterButton, LogLine 等) 保持不变 ...
// ... (omitting for brevity, they are the same as before)
const FilterGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
`;

const FilterButton = styled.button<{ $isActive: boolean }>`
  background-color: transparent;
  border: 1px solid #6b7280;
  color: #d1d5db;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  cursor: pointer;
  font-size: 0.8rem;
  text-transform: uppercase;
  transition: all 0.2s ease;

  ${(props) =>
    props.$isActive &&
    css`
      background-color: #4f46e5;
      border-color: #4f46e5;
      color: #ffffff;
      font-weight: bold;
    `}
  
  &:hover {
    border-color: #a5b4fc;
  }
`;

const ToggleWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 0.3rem;

  label {
    font-size: 0.85rem;
    color: #9ca3af;
    cursor: pointer;
  }
  
  input[type="checkbox"] {
    cursor: pointer;
  }
`;

const LogLine = styled.div<{ $level: string }>`
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  line-height: 1.5;
  border-left: 3px solid;
  padding-left: 0.75rem;
  border-color: ${(props) => {
    switch (props.$level) {
      case 'error': return '#ef4444';
      case 'success': return '#22c55e';
      case 'info': return '#3b82f6';
      case 'warning': return '#f59e0b';
      default: return '#6b7280';
    }
  }};
`;

const LogLevel = styled.span<{ $level: string }>`
  font-weight: bold;
  font-size: 0.8rem;
  flex-shrink: 0;
  color: ${(props) => {
    switch (props.$level) {
      case 'error': return '#fca5a5';
      case 'success': return '#86efac';
      case 'info': return '#93c5fd';
      case 'warning': return '#fcd34d';
      default: return '#9ca3af';
    }
  }};
`;

const LineNumber = styled.span`
  font-size: 0.8rem;
  color: #9ca3af;
  flex-shrink: 0;
`;

const Message = styled.span`
  color: #e5e7eb;
  white-space: pre-wrap;
`;

export default OutputPanel;