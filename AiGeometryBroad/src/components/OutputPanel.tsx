import React, { useState, useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { ObjectPropertyKey, VariableInfo } from '../core/DSLInterpreter';
import type { PropertySyncOptions } from '../core/dslPropertySync';
import { splitLatexParts } from '../core/latexSplit';
import styled, { css } from 'styled-components';

export interface LogMessage {
  id: number;
  level: string;
  line?: number;
  message: string;
}

// 错误信息里的 `$...$` 往往是用户脚本原文的片段，渲成公式会把报错文本拆得没法读，
// 所以 error 级别一律按纯文本输出。
function RenderedMessage({ message, enableLatex = true }: { message: string; enableLatex?: boolean }): React.ReactElement {
  if (!enableLatex) {
    return <>{message}</>;
  }
  return (
    <>
      {splitLatexParts(message).map((part, index) => {
        if (part.kind === 'text') {
          return <React.Fragment key={`text-${index}`}>{part.value}</React.Fragment>;
        }
        try {
          const html = katex.renderToString(part.value, {
            displayMode: part.displayMode === true,
            throwOnError: false,
            strict: 'ignore',
          });
          return <span key={`latex-${index}`} dangerouslySetInnerHTML={{ __html: html }} />;
        } catch {
          return <React.Fragment key={`fallback-${index}`}>{part.raw ?? part.value}</React.Fragment>;
        }
      })}
    </>
  );
}

// 1. 让 props 接收 title
interface OutputPanelProps {
  title: string;
  logs: LogMessage[];
  variables: VariableInfo[];
  onToggleRandomVariable: (name: string, frozen: boolean) => void;
  onToggleRandomObject: (name: string, frozen: boolean) => void;
  onTogglePointFrozen: (name: string, frozen: boolean, lineNumber?: number) => void;
  selectedObjectName: string | null;
  onSelectObject: (name: string | null) => void;
  onObjectPropertyChange: (name: string, changes: Partial<Record<ObjectPropertyKey, number>>, options?: PropertySyncOptions) => void;
  /** 截止点：整串值写回 `cutPoints=`（例如 `-A,+B`）。 */
  onCutPointsChange: (name: string, value: string, lineNumber?: number) => void;
  /** 标签：整串文本写回 `label=`；空串表示不显示标签（把参数删掉）。 */
  onLabelChange: (name: string, value: string, lineNumber?: number) => void;
  /** 进入画布点选：点到的点会以 `sign` 指定的方向追加为截止点。 */
  onPickCutPoint: (name: string, sign: '+' | '-') => void;
}

interface ObjectDetailHandlers {
  onObjectPropertyChange: OutputPanelProps['onObjectPropertyChange'];
  onCutPointsChange: OutputPanelProps['onCutPointsChange'];
  onLabelChange: OutputPanelProps['onLabelChange'];
  onPickCutPoint: OutputPanelProps['onPickCutPoint'];
}

const OutputPanel: React.FC<OutputPanelProps> = ({ title, logs, variables, onToggleRandomVariable, onToggleRandomObject, onTogglePointFrozen, selectedObjectName, onSelectObject, onObjectPropertyChange, onCutPointsChange, onLabelChange, onPickCutPoint }) => {
  const detailHandlers: ObjectDetailHandlers = { onObjectPropertyChange, onCutPointsChange, onLabelChange, onPickCutPoint };
  const [showLevel, setShowLevel] = useState(false);
  const [showLine, setShowLine] = useState(true);
  const [activeFilter] = useState('all');
  // 默认停在 Variables：日常操作（看变量、改属性、冻结）都在这里，
  // 日志只在排查问题时才需要切过去看。
  const [activeTab, setActiveTab] = useState<'output' | 'variables'>('variables');

  const filteredLogs = useMemo(() => {
    if (activeFilter === 'all') return logs;
    return logs.filter(log => log.level === activeFilter);
  }, [logs, activeFilter]);

  const fixedVariables = variables.filter(variable => variable.kind === 'fixed');
  const randomVariables = variables.filter(variable => variable.kind === 'random');
  const objects = variables.filter(variable => variable.kind === 'object');
  const regularObjects = objects.filter(object => !object.randomObject);
  const randomObjects = objects.filter(object => object.randomObject);

  return (
    <PanelContainer>
      <TabHeaderContainer>
        <TabButton $isActive={activeTab === 'variables'} onClick={() => setActiveTab('variables')}>
          Variables <TabCount>{variables.length}</TabCount>
        </TabButton>
        <TabButton $isActive={activeTab === 'output'} onClick={() => setActiveTab('output')}>
          {title}
        </TabButton>
      </TabHeaderContainer>

      {activeTab === 'output' ? (
        <TabContentContainer>
          <ControlsContainer>
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
                <Message><RenderedMessage message={log.message} enableLatex={log.level !== 'error'} /></Message>
              </LogLine>
            ))}
          </LogList>
        </TabContentContainer>
      ) : (
        <TabContentContainer>
          <VariableSummary>
            <span>Variable values</span>
            <VariableCount>{variables.length}</VariableCount>
          </VariableSummary>
          <VariableGroup>
            <VariableGroupTitle>Fixed variables</VariableGroupTitle>
            {fixedVariables.length === 0 ? (
              <EmptyVariables>No fixed variables</EmptyVariables>
            ) : fixedVariables.map(variable => (
              <VariableRow key={variable.name}>
                <VariableName>{variable.name}</VariableName>
                <VariableValue title={variable.expression}>{formatVariableValue(variable.value)}</VariableValue>
              </VariableRow>
            ))}
          </VariableGroup>
          <VariableGroup>
            <VariableGroupTitle>Random variables</VariableGroupTitle>
            {randomVariables.length === 0 ? (
              <EmptyVariables>No random variables</EmptyVariables>
            ) : randomVariables.map(variable => (
              <VariableRow key={variable.name} $random>
                <div>
                  <VariableName>{variable.name}</VariableName>
                  <VariableExpression title={variable.expression}>{variable.expression}</VariableExpression>
                </div>
                <VariableAction
                  type="button"
                  $frozen={variable.frozen}
                  onClick={() => onToggleRandomVariable(variable.name, !variable.frozen)}
                >
                  {variable.frozen ? 'Unfreeze' : 'Freeze'}
                </VariableAction>
                <VariableValue>{formatVariableValue(variable.value)}</VariableValue>
              </VariableRow>
            ))}
          </VariableGroup>
          <VariableGroup>
            <VariableGroupTitle>Objects</VariableGroupTitle>
            {regularObjects.length === 0 ? (
              <EmptyVariables>No objects</EmptyVariables>
            ) : regularObjects.map(object => (
              <React.Fragment key={`object-${object.name}`}>
                <ObjectRow
                  $selected={selectedObjectName === object.name}
                  onClick={() => onSelectObject(object.name)}
                >
                  <VariableName>{object.name}</VariableName>
                  {/* 只有点能冻结。冻结写进 DSL 的 frozen 属性，画布据此拒绝拖动。
                      非点对象占一个空位，保持三列网格对齐。 */}
                  {object.objectType === 'point' ? (
                    <VariableAction
                      type="button"
                      $frozen={Boolean(object.pointFrozen)}
                      title="冻结后该点在画布上无法拖动（写回 CREATE POINT 的 frozen 属性）"
                      onClick={(event) => {
                        event.stopPropagation();
                        onTogglePointFrozen(object.name, !object.pointFrozen, object.lineNumber);
                      }}
                    >
                      {object.pointFrozen ? 'Unfreeze' : 'Freeze'}
                    </VariableAction>
                  ) : <span />}
                  <VariableValue title={object.expression}>{object.objectType || object.expression}</VariableValue>
                </ObjectRow>
                {selectedObjectName === object.name && renderObjectDetails(object, detailHandlers)}
              </React.Fragment>
            ))}
          </VariableGroup>
          <VariableGroup>
            <VariableGroupTitle>Random objects</VariableGroupTitle>
            {randomObjects.length === 0 ? (
              <EmptyVariables>No random objects</EmptyVariables>
            ) : randomObjects.map(object => (
              <React.Fragment key={`random-object-${object.name}`}>
                <ObjectRow
                  $random
                  $selected={selectedObjectName === object.name}
                  onClick={() => onSelectObject(object.name)}
                >
                  <div>
                    <VariableName>{object.name}</VariableName>
                    <VariableExpression title={object.randomSource}>{object.randomSource}</VariableExpression>
                  </div>
                  <VariableAction
                    type="button"
                    $frozen={object.frozen}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleRandomObject(object.name, !object.frozen);
                    }}
                  >
                    {object.frozen ? 'Unfreeze' : 'Freeze'}
                  </VariableAction>
                  <VariableValue>{object.objectType || object.expression}</VariableValue>
                </ObjectRow>
                {selectedObjectName === object.name && renderObjectDetails(object, detailHandlers)}
              </React.Fragment>
            ))}
          </VariableGroup>
        </TabContentContainer>
      )}
    </PanelContainer>
  );
};

function formatVariableValue(value: VariableInfo['value']): string {
  return typeof value === 'number' ? Number(value.toFixed(6)).toString() : String(value);
}

function renderObjectDetails(
  object: VariableInfo,
  handlers: ObjectDetailHandlers,
): React.ReactElement {
  const { onObjectPropertyChange, onCutPointsChange, onLabelChange, onPickCutPoint } = handlers;
  const cutPoints = object.editableCutPoints;
  const label = object.editableLabel;
  const hasEditableProperties = Boolean(object.editableProperties && object.editableProperties.length > 0);
  const lineNumber = object.editableProperties?.[0]?.lineNumber ?? cutPoints?.lineNumber ?? label?.lineNumber;

  return (
    <ObjectDetails>
      <ObjectDetailsTitle>{object.name} · {object.objectType}</ObjectDetailsTitle>
      {Object.entries(object.details || {}).map(([key, value]) => (
        <ObjectDetailRow key={key}>
          <span>{key}</span>
          <strong>{value}</strong>
        </ObjectDetailRow>
      ))}
      {(hasEditableProperties || cutPoints || label) && (
        <EditableProperties>
          <EditablePropertiesTitle>可编辑属性 · 第 {lineNumber} 行</EditablePropertiesTitle>
          {object.editableProperties?.map(property => (
            <EditablePropertyRow key={property.key}>
              <EditablePropertyLabel title={property.reason}>{property.label}</EditablePropertyLabel>
              <EditablePropertyInput
                key={`${property.key}-${property.value}`}
                type="number"
                step="any"
                defaultValue={property.value}
                disabled={!property.editable}
                title={property.reason || '修改后同步回 DSL 代码'}
                onBlur={event => {
                  const nextValue = Number(event.currentTarget.value);
                  if (property.editable && Number.isFinite(nextValue)) {
                    onObjectPropertyChange(
                      object.name,
                      { [property.key]: nextValue },
                      { lineNumber: property.lineNumber },
                    );
                  }
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </EditablePropertyRow>
          ))}
          {label && (
            // 标签是字符串，所以走 onLabelChange 而不是 onObjectPropertyChange（后者只收数值）。
            // 输入框受控于 defaultValue + key：值变了就重建，避免把用户没提交的输入冲掉。
            <EditablePropertyRow>
              <EditablePropertyLabel title={label.reason}>{label.label}</EditablePropertyLabel>
              <LabelInput
                key={`label-${label.value}`}
                type="text"
                defaultValue={label.value}
                placeholder="留空 = 不显示"
                spellCheck={false}
                disabled={!label.editable}
                title={label.reason || '修改后同步回 DSL 代码'}
                onBlur={event => {
                  if (label.editable) {
                    onLabelChange(object.name, event.currentTarget.value, label.lineNumber);
                  }
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </EditablePropertyRow>
          )}
          {cutPoints && (
            <CutPointRow>
              <CutPointHeader>
                <EditablePropertyLabel title={cutPoints.reason}>{cutPoints.label}</EditablePropertyLabel>
                <CutPointButtons>
                  {/* 点选后写 `+P`：砍掉 P 正方向那一侧，保留到 P 为止。 */}
                  <CutPointButton
                    type="button"
                    title="在画布上点一个点，写成 +P：隐藏它的正方向一侧"
                    onClick={() => onPickCutPoint(object.name, '+')}
                  >
                    + 点选
                  </CutPointButton>
                  {/* 点选后写 `-P`：砍掉 P 负方向那一侧，从 P 开始保留。两个点各选一次就是线段。 */}
                  <CutPointButton
                    type="button"
                    title="在画布上点一个点，写成 -P：隐藏它的负方向一侧"
                    onClick={() => onPickCutPoint(object.name, '-')}
                  >
                    − 点选
                  </CutPointButton>
                  <CutPointButton
                    type="button"
                    title="清空截止点，恢复成完整的直线 / 射线"
                    onClick={() => onCutPointsChange(object.name, '', cutPoints.lineNumber)}
                  >
                    清空
                  </CutPointButton>
                </CutPointButtons>
              </CutPointHeader>
              <CutPointInput
                key={`cutPoints-${cutPoints.value}`}
                type="text"
                defaultValue={cutPoints.value}
                placeholder="例如 -A,+B"
                spellCheck={false}
                disabled={!cutPoints.editable}
                title={cutPoints.reason}
                onBlur={event => {
                  if (cutPoints.editable) {
                    onCutPointsChange(object.name, event.currentTarget.value, cutPoints.lineNumber);
                  }
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </CutPointRow>
          )}
        </EditableProperties>
      )}
    </ObjectDetails>
  );
}

// --- Styles ---

// 4. 将原 Panel 的样式和 LogContainer 的样式合并
const PanelContainer = styled.div`
  /* 来自原 Panel 的样式 */
  background-color: #ffffff; /* 通常面板有自己的背景 */
  border-radius: 8px;
  width: 300px; /* 您可以按需设置宽度 */
  flex-shrink: 0;

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
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: #7f8c8d;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
`;

const TabHeaderContainer = styled.div`
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid #4b5563;
`;

const TabButton = styled.button<{ $isActive: boolean }>`
  flex: 1;
  min-width: 0;
  padding: 0.75rem 0.5rem;
  border: none;
  border-bottom: 2px solid ${(props) => props.$isActive ? '#818cf8' : 'transparent'};
  background: transparent;
  color: ${(props) => props.$isActive ? '#f9fafb' : '#9ca3af'};
  cursor: pointer;
  font-family: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.35px;
  transition: color 0.2s ease, border-color 0.2s ease;

  &:hover {
    color: #ffffff;
  }
`;

const TabCount = styled.span`
  margin-left: 0.35rem;
  color: #9ca3af;
  font-size: 0.72rem;
  font-weight: 400;
`;

const TabContentContainer = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 1rem 1.25rem;
  overflow-y: auto;
`;

const VariableSummary = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #f3f4f6;
  font-size: 0.82rem;
  font-weight: bold;
  margin-bottom: 0.75rem;
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

const VariableSection = styled.div`
  flex-shrink: 0;
  max-height: 38%;
  overflow-y: auto;
  padding: 0.7rem 0;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid #4b5563;
`;

const VariableSectionTitle = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #f3f4f6;
  font-size: 0.85rem;
  font-weight: bold;
  margin-bottom: 0.6rem;
`;

const VariableCount = styled.span`
  color: #9ca3af;
  font-size: 0.75rem;
`;

const VariableGroup = styled.div`
  margin-bottom: 0.65rem;
`;

const VariableGroupTitle = styled.div`
  color: #9ca3af;
  font-size: 0.72rem;
  margin-bottom: 0.35rem;
  text-transform: uppercase;
`;

const EmptyVariables = styled.div`
  color: #6b7280;
  font-size: 0.75rem;
  padding: 0.2rem 0;
`;

const VariableRow = styled.div<{ $random?: boolean }>`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.3rem 0.45rem;
  margin-bottom: 0.25rem;
  border-left: 2px solid ${(props) => props.$random ? '#f59e0b' : '#3b82f6'};
  background: rgba(255, 255, 255, 0.04);
`;

const ObjectRow = styled.div<{ $random?: boolean; $selected?: boolean }>`
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.3rem 0.45rem;
  margin-bottom: 0.25rem;
  border: none;
  border-left: 2px solid ${(props) => props.$random ? '#f59e0b' : '#3b82f6'};
  background: ${(props) => props.$selected ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.04)'};
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: rgba(99, 102, 241, 0.18);
  }
`;

const ObjectDetails = styled.div`
  margin-top: 0.5rem;
  padding: 0.6rem 0.65rem;
  border: 1px solid #4b5563;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.12);
`;

const ObjectDetailsTitle = styled.div`
  color: #f9fafb;
  font-size: 0.78rem;
  font-weight: bold;
  margin-bottom: 0.45rem;
`;

const EditableProperties = styled.div`
  margin-top: 0.7rem;
  padding-top: 0.55rem;
  border-top: 1px solid #4b5563;
`;

const EditablePropertiesTitle = styled.div`
  margin-bottom: 0.4rem;
  color: #a5b4fc;
  font-size: 0.68rem;
`;

const EditablePropertyRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
`;

const EditablePropertyLabel = styled.span`
  color: #cbd5e1;
  font-size: 0.72rem;
`;

const EditablePropertyInput = styled.input`
  width: 84px;
  box-sizing: border-box;
  padding: 0.2rem 0.3rem;
  border: 1px solid #64748b;
  border-radius: 3px;
  background: #111827;
  color: #f9fafb;
  font: inherit;
  font-size: 0.72rem;

  &:focus {
    outline: 1px solid #818cf8;
    border-color: #818cf8;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

// 标签是自由文本（「点 P」「直线 l」甚至 $LaTeX$），比数值宽一些才够用。
const LabelInput = styled.input`
  width: 128px;
  box-sizing: border-box;
  padding: 0.2rem 0.3rem;
  border: 1px solid #64748b;
  border-radius: 3px;
  background: #111827;
  color: #f9fafb;
  font: inherit;
  font-size: 0.72rem;

  &:focus {
    outline: 1px solid #818cf8;
    border-color: #818cf8;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

// 截止点是「一串点名 + 方向」，一行放不下标签、输入框和三个按钮，
// 所以单独排成「标签/按钮在上、输入框占满整行」的两行结构。
const CutPointRow = styled.div`
  margin-bottom: 0.35rem;
`;

const CutPointHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
`;

const CutPointButtons = styled.div`
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
`;

const CutPointButton = styled.button`
  border: 1px solid #6b7280;
  background: transparent;
  color: #d1d5db;
  border-radius: 4px;
  padding: 0.12rem 0.3rem;
  font-family: inherit;
  font-size: 0.66rem;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    border-color: #a5b4fc;
    color: #ffffff;
  }
`;

const CutPointInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 0.2rem 0.3rem;
  border: 1px solid #64748b;
  border-radius: 3px;
  background: #111827;
  color: #f9fafb;
  font: inherit;
  font-size: 0.72rem;

  &:focus {
    outline: 1px solid #818cf8;
    border-color: #818cf8;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

const ObjectDetailRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.18rem 0;
  color: #9ca3af;
  font-size: 0.72rem;

  strong {
    color: #e5e7eb;
    font-weight: 400;
  }
`;

const VariableName = styled.div`
  color: #f9fafb;
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const VariableExpression = styled.div`
  color: #9ca3af;
  font-size: 0.68rem;
  max-width: 125px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const VariableValue = styled.span`
  color: #d1d5db;
  font-size: 0.75rem;
  max-width: 92px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const VariableAction = styled.button<{ $frozen: boolean }>`
  border: 1px solid ${(props) => props.$frozen ? '#22c55e' : '#6b7280'};
  background: transparent;
  color: ${(props) => props.$frozen ? '#86efac' : '#d1d5db'};
  border-radius: 4px;
  padding: 0.18rem 0.35rem;
  font-size: 0.68rem;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    border-color: #a5b4fc;
    color: #ffffff;
  }
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
  min-width: 0;
  white-space: pre-wrap;
  word-break: normal;
  overflow-wrap: normal;

  /* 不允许窄面板把 KaTeX 的内部 glyph 拆成竖排；超长公式由消息区域横向溢出。 */
  .katex {
    white-space: nowrap;
  }

  .katex-display {
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
  }
`;

export default OutputPanel;