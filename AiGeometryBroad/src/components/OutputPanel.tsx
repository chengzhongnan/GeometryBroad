import React, { useState, useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { ObjectPropertyKey, VariableInfo } from '../core/DSLInterpreter';
import type { PropertySyncOptions } from '../core/dslPropertySync';
import { splitLatexParts } from '../core/latexSplit';
import styled, { css } from 'styled-components';
import ObjectPropertyEditor, { type ObjectPropertyEditorHandlers } from './ObjectPropertyEditor';

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
  /**
   * 当前**全部**选中对象的名字。
   *
   * 和 `selectedObjectName`（最后一个选中的，也就是「主选」）分工不同：
   * 主选决定详情区显示谁，这个决定哪些行打勾。画布上框选 / Ctrl 多选之后
   * 这里会有多个名字，面板要跟着一起打勾。
   */
  selectedObjectNames: string[];
  onSelectObject: (name: string | null, additive?: boolean) => void;
  /**
   * 在对象行上右键：请求弹出和画布上**同一个**对象菜单。
   *
   * 画布上对象重叠时很难点中想要的那个（点到的总是最上面那个），
   * 从列表里右键就不存在这个问题 —— 名字是确定的。
   * 传页面坐标，菜单按视口定位。
   */
  onRequestObjectMenu: (name: string, clientX: number, clientY: number) => void;
  onObjectPropertyChange: (name: string, changes: Partial<Record<ObjectPropertyKey, number>>, options?: PropertySyncOptions) => void;
  /** 截止点：整串值写回 `cutPoints=`（例如 `-A,+B`）。 */
  onCutPointsChange: (name: string, value: string, lineNumber?: number) => void;
  /** 标签：整串文本写回 `label=`；空串表示不显示标签（把参数删掉）。 */
  onLabelChange: (name: string, value: string, lineNumber?: number) => void;
  /** 进入画布点选：点到的点会以 `sign` 指定的方向追加为截止点。 */
  onPickCutPoint: (name: string, sign: '+' | '-') => void;
}

/**
 * 详情区的编辑能力。直接复用「编辑对象」弹窗那一套类型 ——
 * 面板和弹窗共用同一个组件（ObjectPropertyEditor），回调形状必须一致。
 */
type ObjectDetailHandlers = ObjectPropertyEditorHandlers;

/** 派生部件在面板里的角色文案。边比顶点更常被引用，所以放在值那一列醒目的位置。 */
const PART_ROLE_LABEL: Record<string, string> = {
  vertex: '顶点',
  edge: '边',
};
// 复用同一个空数组，避免每次渲染都造新引用。
const EMPTY_PARTS: VariableInfo[] = [];

const OutputPanel: React.FC<OutputPanelProps> = ({ title, logs, variables, onToggleRandomVariable, onToggleRandomObject, onTogglePointFrozen, selectedObjectName, selectedObjectNames, onSelectObject, onRequestObjectMenu, onObjectPropertyChange, onCutPointsChange, onLabelChange, onPickCutPoint }) => {
  const detailHandlers: ObjectDetailHandlers = { onObjectPropertyChange, onCutPointsChange, onLabelChange, onPickCutPoint };
  // 勾选状态查询。用 Set 而不是每次 includes：对象多的时候（几百个点）
  // 每行都扫一遍数组会明显变慢。
  const selectedSet = useMemo(() => new Set(selectedObjectNames), [selectedObjectNames]);
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
  // 多边形自动派生出来的顶点 / 边带 `parentName`，收在父对象下面折叠显示：
  // 一个矩形就会多出 8 个部件，平铺出来的话画布稍微复杂点面板就没法看了。
  const regularObjects = objects.filter(object => !object.randomObject && !object.parentName);
  const randomObjects = objects.filter(object => object.randomObject && !object.parentName);

  const partsByParent = useMemo(() => {
    const map = new Map<string, VariableInfo[]>();
    for (const variable of objects) {
      if (!variable.parentName) continue;
      const list = map.get(variable.parentName);
      if (list) list.push(variable);
      else map.set(variable.parentName, [variable]);
    }
    return map;
  }, [objects]);

  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const toggleParts = (name: string) => {
    setExpandedParents(previous => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // 选中了某个部件时自动展开它的父对象 —— 否则在画布上点中一条边，
  // 面板里既看不到它被选中、也找不到它藏在哪。
  const isParentExpanded = (name: string, parts: VariableInfo[]): boolean =>
    expandedParents.has(name) || parts.some(part => part.name === selectedObjectName);

  /**
   * 对象行前面的勾选框。
   *
   * 勾选状态**完全由选中集合派生**（而不是自己存一份）：画布上点选、框选、Ctrl 多选
   * 之后这里立刻跟着打勾，两边不可能对不上。反过来勾一下就走
   * `onSelectObject(name, true)`（additive = 切换），和画布上 Ctrl 点一下是同一个动作。
   */
  const renderSelectCheckbox = (name: string): React.ReactElement => {
    const checked = selectedSet.has(name);
    return (
      <SelectionCheckbox
        type="checkbox"
        checked={checked}
        aria-label={`选择 ${name}`}
        title={checked ? `取消选择 ${name}` : `选择 ${name}（可以多选）`}
        onChange={() => onSelectObject(name, true)}
      />
    );
  };

  const renderObjectEntry = (object: VariableInfo, isPart: boolean): React.ReactElement => {
    const parts = isPart ? EMPTY_PARTS : partsByParent.get(object.name) ?? EMPTY_PARTS;
    const expanded = parts.length > 0 && isParentExpanded(object.name, parts);
    return (
      <React.Fragment key={`object-${object.name}`}>
        <ObjectRow
          $part={isPart}
          // 多选时**每一个**选中的行都高亮：只高亮「最后一个」的话，
          // 用户框选了五个对象，面板里看起来只选中了一个。
          $selected={selectedSet.has(object.name)}
          onClick={() => onSelectObject(object.name)}
          onContextMenu={(event) => {
            event.preventDefault();
            onRequestObjectMenu(object.name, event.clientX, event.clientY);
          }}
        >
          {/* 勾选框自己吃掉 click：不然点一下勾选会冒泡到整行，触发「单选」，
              刚攒起来的多选当场被清掉。 */}
          <CheckboxCell onClick={event => event.stopPropagation()}>
            {renderSelectCheckbox(object.name)}
          </CheckboxCell>
          <ObjectNameCell>
            <ObjectNameText>{object.name}</ObjectNameText>
            {parts.length > 0 && (
              <PartToggle
                type="button"
                aria-expanded={expanded}
                title="展开 / 收起它的顶点与边"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleParts(object.name);
                }}
              >
                {expanded ? '▾' : '▸'} {parts.length}
              </PartToggle>
            )}
          </ObjectNameCell>
          {/* 只有点能冻结，而且**派生部件不给这个按钮**：顶点别名指向的是用户那个点
              （要冻去冻它本体），合成顶点在脚本里没有 frozen 可写 —— 给了就是个死按钮。 */}
          {object.objectType === 'point' && !isPart ? (
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
          <VariableValue title={object.expression}>
            {object.partRole ? (PART_ROLE_LABEL[object.partRole] ?? object.partRole)
              : (object.objectType || object.expression)}
          </VariableValue>
        </ObjectRow>
        {selectedObjectName === object.name && (
          <ObjectPropertyEditor object={object} handlers={detailHandlers} />
        )}
        {expanded && parts.map(part => renderObjectEntry(part, true))}
      </React.Fragment>
    );
  };

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
            ) : regularObjects.map(object => renderObjectEntry(object, false))}
          </VariableGroup>
          <VariableGroup>
            <VariableGroupTitle>Random objects</VariableGroupTitle>
            {randomObjects.length === 0 ? (
              <EmptyVariables>No random objects</EmptyVariables>
            ) : randomObjects.map(object => (
              <React.Fragment key={`random-object-${object.name}`}>
                <ObjectRow
                  $random
                  $selected={selectedSet.has(object.name)}
                  onClick={() => onSelectObject(object.name)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onRequestObjectMenu(object.name, event.clientX, event.clientY);
                  }}
                >
                  <CheckboxCell onClick={event => event.stopPropagation()}>
                    {renderSelectCheckbox(object.name)}
                  </CheckboxCell>
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
                {selectedObjectName === object.name && (
                  <ObjectPropertyEditor object={object} handlers={detailHandlers} />
                )}
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

const ObjectRow = styled.div<{ $random?: boolean; $selected?: boolean; $part?: boolean }>`
  width: 100%;
  display: grid;
  /* 勾选框 | 名字 | 冻结按钮 | 值 */
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.3rem 0.45rem;
  margin-bottom: 0.25rem;
  border: none;
  /* 派生部件换一种强调色 + 缩进，一眼能看出它是「挂在别人下面的」。 */
  border-left: 2px solid ${(props) => props.$random ? '#f59e0b' : props.$part ? '#a78bfa' : '#3b82f6'};
  margin-left: ${(props) => props.$part ? '0.9rem' : '0'};
  background: ${(props) => props.$selected ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.04)'};
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: rgba(99, 102, 241, 0.18);
  }
`;

/**
 * 勾选框那一格。单独包一层是为了拦住 click 冒泡 —— 直接在 input 上写
 * `onClick={e => e.stopPropagation()}` 也能拦住整行，但那样就把
 * 「勾选框自己的 onChange」和「整行的 onClick」的先后顺序搅在一起了，
 * 外面套一层、各管各的更清楚。
 */
const CheckboxCell = styled.span`
  display: flex;
  align-items: center;
`;

const SelectionCheckbox = styled.input`
  width: 13px;
  height: 13px;
  margin: 0;
  /* 用浏览器自带的强调色，不必自己画一个「假复选框」再维护选中态样式。 */
  accent-color: #6366f1;
  cursor: pointer;
`;

/**
 * 对象行的「名字」格。比 `VariableName` 多一层 flex：
 * 名字 + 展开部件的小按钮要并排，而 `VariableName` 是纯单行截断的 div，
 * 直接塞按钮会被 `overflow: hidden` 裁掉。
 */
const ObjectNameCell = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
`;

const ObjectNameText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/** 父对象那一行上的「展开 / 收起部件」按钮，顺带显示部件数量。 */
const PartToggle = styled.button`
  margin-left: 0.4rem;
  padding: 0 0.3rem;
  border: 1px solid #4b5563;
  border-radius: 3px;
  background: transparent;
  color: #cbd5e1;
  font-family: inherit;
  font-size: 0.65rem;
  line-height: 1.4;
  cursor: pointer;
  vertical-align: middle;

  &:hover {
    border-color: #818cf8;
    color: #e0e7ff;
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