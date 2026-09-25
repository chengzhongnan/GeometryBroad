import React, { useState, useRef, useCallback, useEffect } from 'react';
import styled from 'styled-components';

import TabsPanel from './TabsPanel';
import AIChatPanel from './AIChatPanel';
import ScriptInputPanel from './ScriptInputPanel';
import OutputPanel, { type LogMessage } from './OutputPanel';
import GeometricCanvas, { type CutPointPickRequest } from './GeometryCanvas';
import ScriptTreePanel from './ScriptTreePanel';
import type { FileNodeData } from './TreeNode';

import { useContainerSize } from '../hooks/useContainerSize';

import { INITIAL_USER_INPUT } from './InitScript';
import type { ObjectPropertyKey, TopLevelCommandInfo, VariableInfo } from '../core/DSLInterpreter';
import { updateDslObjectCutPoints, updateDslObjectFrozen, updateDslObjectLabel, updateDslObjectProperty, type PropertySyncOptions } from '../core/dslPropertySync';
import { removeObjectsFromScript, rewriteLinearDefinition, type LinearTrimRewrite } from '../core/dslObjectEditing';
import {
    createHistory,
    recordHistory,
    redoHistory,
    TYPING_COALESCE_KEY,
    undoHistory,
    type ScriptHistoryState,
    type ScriptSnapshot,
} from '../core/scriptHistory';
import type { IPoint } from '../core/geometry/base';

const SCRIPT_STORAGE_KEY = 'geo-script-last-code';
const FILES_STORAGE_KEY = 'geo-script-files';

const DEFAULT_FILES: FileNodeData[] = [
    {
        id: '1',
        name: 'scripts',
        type: 'folder',
        children: [
            { id: '2', name: 'create_geometry.geo', type: 'file', content: INITIAL_USER_INPUT },
        ],
    },
    { id: '4', name: 'README.md', type: 'file', content: '# GeometryBroad scripts\\n' },
];

function updateFileContent(nodes: FileNodeData[], fileId: string, content: string): FileNodeData[] {
    return nodes.map(node => {
        if (node.id === fileId && node.type === 'file') {
            return { ...node, content };
        }
        if (node.children) {
            return { ...node, children: updateFileContent(node.children, fileId, content) };
        }
        return node;
    });
}

function findFile(nodes: FileNodeData[], fileId: string): FileNodeData | null {
    for (const node of nodes) {
        if (node.id === fileId && node.type === 'file') return node;
        if (node.children) {
            const match = findFile(node.children, fileId);
            if (match) return match;
        }
    }
    return null;
}

function MainContent() {

    const [userInput, setUserInput] = useState<string>(INITIAL_USER_INPUT);
    const [generatedScript, setGeneratedScript] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [revision, setRevision] = useState<number>(0);
    const [files, setFiles] = useState<FileNodeData[]>(() => {
        const savedFiles = localStorage.getItem(FILES_STORAGE_KEY);
        if (!savedFiles) return DEFAULT_FILES;
        try {
            const parsed = JSON.parse(savedFiles) as FileNodeData[];
            return Array.isArray(parsed) ? parsed : DEFAULT_FILES;
        } catch {
            return DEFAULT_FILES;
        }
    });
    const [activeFileId, setActiveFileId] = useState<string | null>(null);
    const [saveStatus, setSaveStatus] = useState<string>('');

    const [canvasWrapperRef, canvasDimensions] = useContainerSize<HTMLDivElement>();

    // 创建 state 存储日志消息
    const [logMessages, setLogMessages] = useState<LogMessage[]>([]);
    const [variables, setVariables] = useState<VariableInfo[]>([]);
    const [frozenRandomVariables, setFrozenRandomVariables] = useState<Record<string, number>>({});
    const [frozenRandomObjects, setFrozenRandomObjects] = useState<Record<string, { x: number; y: number }>>({});
    const [selectedObjectNames, setSelectedObjectNames] = useState<string[]>([]);
    const selectedObjectName = selectedObjectNames[selectedObjectNames.length - 1] || null;
    const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
    const [labelPositions, setLabelPositions] = useState<Record<string, IPoint>>({});
    // 「正在为哪条线挑截止点」。非空时画布进入点选模式，点一个点就把它写进 cutPoints。
    const [cutPointPick, setCutPointPick] = useState<CutPointPickRequest | null>(null);
    // 使用 useRef 来为每条消息生成一个唯一的ID，避免不必要的重渲染
    const messageIdCounter = useRef(0);

    const [script, setScript] = useState<string>(() => {
        const savedScript = localStorage.getItem(SCRIPT_STORAGE_KEY);
        // 如果 localStorage 中有保存的脚本，则使用它，否则使用初始默认脚本
        return savedScript || INITIAL_USER_INPUT;
    });

    // ---- 撤销 / 重做 ----
    // 历史只覆盖「脚本」这一份文档状态：本应用里所有用户操作最终都落成对脚本的改写，
    // 所以一个栈就够（详见 core/scriptHistory.ts 的说明）。
    // 视图状态（平移/缩放、选中、标签位置、随机数冻结）不是文档，不进撤销栈。
    const [history, setHistory] = useState<ScriptHistoryState>(() => createHistory());

    // 记一次改动。previous 必须是**改动前**的那一对快照。
    // coalesceKey 只给连续打字用；删除 / 截取 / 改属性这类操作各占一步，传 null。
    // 时间戳在调用点取（= 用户动作发生的时刻），不要塞进 updater 里 ——
    // updater 是渲染时才执行的，批量处理时几次按键会拿到同一个 now，合并判断就失真了。
    const pushHistory = useCallback((previous: ScriptSnapshot, coalesceKey: string | null = null) => {
        const now = Date.now();
        setHistory(state => recordHistory(state, previous, { coalesceKey, now }));
    }, []);

    // 把一份快照恢复成当前状态。
    // 只有渲染内容真的变了才重跑解释器 —— 纯打字的撤销不该把正在播的动画重新开始。
    const applySnapshot = useCallback((snapshot: ScriptSnapshot, renderedScript: string) => {
        setScript(snapshot.script);
        setGeneratedScript(snapshot.generatedScript);
        localStorage.setItem(SCRIPT_STORAGE_KEY, snapshot.script);
        if (snapshot.generatedScript !== renderedScript) {
            setLogMessages([]);
            setRevision(previous => previous + 1);
        }
    }, []);

    const handleUndo = useCallback(() => {
        const result = undoHistory(history, { script, generatedScript });
        if (!result) return;
        setHistory(result.state);
        applySnapshot(result.restored, generatedScript);
    }, [history, script, generatedScript, applySnapshot]);

    const handleRedo = useCallback(() => {
        const result = redoHistory(history, { script, generatedScript });
        if (!result) return;
        setHistory(result.state);
        applySnapshot(result.restored, generatedScript);
    }, [history, script, generatedScript, applySnapshot]);

    // 键盘监听里的回调走 ref 递进去，避免每次重渲染都重绑 window 监听器
    // （和 GeometryCanvas 里 redrawRef / exitTrimModeRef 是同一套做法）。
    const undoRef = useRef(handleUndo);
    const redoRef = useRef(handleRedo);
    useEffect(() => {
        undoRef.current = handleUndo;
        redoRef.current = handleRedo;
    }, [handleUndo, handleRedo]);

    useEffect(() => {
        // 普通输入框保留浏览器自带的文本撤销；只有 Monaco 那份交给应用级撤销。
        const isNativeTextEntry = (target: EventTarget | null): boolean => {
            if (!(target instanceof HTMLElement)) return false;
            if (target.closest('.monaco-editor')) return false;
            const tag = target.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
            const key = event.key.toLowerCase();
            const isUndo = key === 'z' && !event.shiftKey;
            const isRedo = key === 'y' || (key === 'z' && event.shiftKey);
            if (!isUndo && !isRedo) return;
            if (isNativeTextEntry(event.target)) return;

            // 捕获阶段就拦下来：Monaco 自己也有一份撤销栈，但它看不到本应用发起的脚本改写，
            // 两边各撤各的会互相打架。统一走应用级撤销，编辑器里的 Ctrl+Z 也归这里。
            event.preventDefault();
            event.stopPropagation();
            if (isUndo) undoRef.current();
            else redoRef.current();
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, []);

    const handleScriptChange = useCallback((next: string) => {
        if (next === script) return;
        // 连续打字合并成一步，否则一次输入要按几十次 Ctrl+Z 才能退回去。
        pushHistory({ script, generatedScript }, TYPING_COALESCE_KEY);
        setScript(next);
    }, [script, generatedScript, pushHistory]);

    const handleSelectFile = useCallback((file: FileNodeData) => {
        if (file.type !== 'file') return;
        setActiveFileId(file.id);
        setScript(file.content || '');
        setSaveStatus('');
        // 换文件等于换了一份文档，历史必须清空 ——
        // 否则在新文件里按 Ctrl+Z 会把上一个文件的内容倒灌进来。
        setHistory(createHistory());
    }, []);

    const handleSaveScript = useCallback(() => {
        localStorage.setItem(SCRIPT_STORAGE_KEY, script);
        if (activeFileId) {
            const nextFiles = updateFileContent(files, activeFileId, script);
            setFiles(nextFiles);
            localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(nextFiles));
            const activeFile = findFile(nextFiles, activeFileId);
            setSaveStatus(activeFile ? `Saved ${activeFile.name}` : 'Saved script');
        } else {
            setSaveStatus('Saved last script');
        }
    }, [activeFileId, files, script]);

    const handleFilesChange = useCallback((nextFiles: FileNodeData[]) => {
        setFiles(nextFiles);
        localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(nextFiles));
    }, []);

    const handleExecuteScript = () => {
        localStorage.setItem(SCRIPT_STORAGE_KEY, script);
        // 渲染内容真的会变才算一步：重复点 Execute 不该把撤销栈塞满。
        if (generatedScript !== script) pushHistory({ script, generatedScript });
        setLogMessages([]);
        setGeneratedScript(script);
        setRevision(previous => previous + 1);
    };

    const handleClearOutputMessage = useCallback(() => {
        setLogMessages([]);
    }, []);

    const handleVariablesChange = useCallback((nextVariables: VariableInfo[]) => {
        setVariables(nextVariables);
    }, []);

    const handleCanvasSelectObject = useCallback((name: string | null, additive = false) => {
        setSelectedObjectNames(previous => {
            let next: string[];
            if (!name) {
                next = [];
            } else if (additive) {
                next = previous.includes(name)
                    ? previous.filter(item => item !== name)
                    : [...previous, name];
            } else {
                next = [name];
            }
            return next;
        });
        setSelectedLabelId(null);
    }, []);

    const handleCanvasSelectLabel = useCallback((labelId: string | null) => {
        setSelectedLabelId(labelId);
        // **不**在这里清空 selectedObjectNames —— 「点击对象同时想保留对象选中」是合法操作
        // （多选、点过对象再移开鼠标等）。调用方在「真的需要清掉对象选中」时已经显式
        // 调了 onSelectObject(null)，这里重写只会把刚选好的对象一键清零，导致左键
        // 选点选不住、连三个点做不出三角形。
        // 反方向：选中对象时清掉 label 选择 —— handleCanvasSelectObject 里已经做了。
    }, []);

    const handleLabelPositionChange = useCallback((labelId: string, position: IPoint) => {
        setLabelPositions(previous => ({
            ...previous,
            [labelId]: position,
        }));
    }, []);

    // 把「改脚本 -> 落盘 -> 重跑」这套收在一处：
    // 优先改编辑器里的脚本（保留用户尚未执行的改动），行号对不上时再退回 generatedScript。
    // apply 返回 null 表示这次改动落不了地，调用方当作无操作处理。
    const commitScriptUpdate = useCallback((apply: (base: string) => string | null) => {
        const fromScript = apply(script);
        let nextScript: string | null = null;
        if (fromScript && fromScript !== script) {
            nextScript = fromScript;
        } else {
            const fromGenerated = apply(generatedScript);
            if (fromGenerated && fromGenerated !== generatedScript) nextScript = fromGenerated;
        }
        if (!nextScript) return;

        // 走到这里说明脚本确实要变，先记一步再落地。
        pushHistory({ script, generatedScript });
        setScript(nextScript);
        setGeneratedScript(nextScript);
        localStorage.setItem(SCRIPT_STORAGE_KEY, nextScript);
        setLogMessages([]);
        setRevision(previous => previous + 1);
    }, [script, generatedScript, pushHistory]);

    const handleObjectPropertyChange = useCallback((
        name: string,
        changes: Partial<Record<ObjectPropertyKey, number>>,
        options?: PropertySyncOptions,
    ) => {
        commitScriptUpdate(base => {
            // 行号来自解释器渲染时建立的“代码行 <-> 对象”映射，因此对 generatedScript 一定成立。
            let nextScript = base;
            let lineNumber = options?.lineNumber;
            for (const [key, value] of Object.entries(changes) as Array<[ObjectPropertyKey, number]>) {
                const update = updateDslObjectProperty(nextScript, name, key, value, { lineNumber });
                if (!update) return null;
                nextScript = update.script;
                lineNumber = update.lineNumber;
            }
            return nextScript;
        });
    }, [commitScriptUpdate]);

    // 冻结 / 解冻点：状态存在代码里（`CREATE POINT ... frozen=true`），
    // 所以改脚本后重跑，画布、变量面板、导出 SVG 都从同一份脚本派生。
    const handleTogglePointFrozen = useCallback((name: string, frozen: boolean, lineNumber?: number) => {
        commitScriptUpdate(base => updateDslObjectFrozen(base, name, frozen, { lineNumber })?.script ?? null);
    }, [commitScriptUpdate]);

    // 把右键作图生成的指令追加到脚本末尾并重新执行。
    // 指令是在 GeometryCanvas 里用同一份 script 生成的（对话框要拿它做实时预览），
    // 这里只负责落地，不再重新推导一遍，避免「预览的代码」和「插入的代码」分叉。
    const handleGeometryCommands = useCallback((commands: string[]) => {
        if (commands.length === 0) return;
        const block = commands.join('\n');
        const nextScript = script.trim()
            ? `${script.trimEnd()}\n\n${block}`
            : block;
        pushHistory({ script, generatedScript });
        setScript(nextScript);
        setGeneratedScript(nextScript);
        localStorage.setItem(SCRIPT_STORAGE_KEY, nextScript);
        setLogMessages([]);
        setRevision(previous => previous + 1);
    }, [script, generatedScript, pushHistory]);

    // 删除对象：同样是改写脚本（渲染是即时进行的，追加一条「不画它」的指令擦不掉已经画上去的东西）。
    // 解释器的顶层指令表由画布在右键那一刻取好一起传上来，这里只负责落地。
    const handleDeleteObjects = useCallback((
        names: string[],
        commands: ReadonlyArray<TopLevelCommandInfo>,
    ) => {
        commitScriptUpdate(base => removeObjectsFromScript(base, commands, names)?.script ?? null);
    }, [commitScriptUpdate]);

    // 截止点属性：整串值写回 `cutPoints=`。空串表示清空（把参数整个删掉，恢复完整直线/射线）。
    // 它是一串点名而不是数值，所以不走 handleObjectPropertyChange。
    const handleCutPointsChange = useCallback((name: string, value: string, lineNumber?: number) => {
        commitScriptUpdate(base => updateDslObjectCutPoints(base, name, value, { lineNumber })?.script ?? null);
    }, [commitScriptUpdate]);

    // 标签属性：整串文本写回 `label=`。空串表示不显示标签（把参数整个删掉）。
    // 和截止点同理，它是字符串、还可能落在 DRAW 行上，所以不走 handleObjectPropertyChange。
    // 面板和右键对话框都走这一个入口，两条路的写回行为不会分叉。
    const handleLabelChange = useCallback((name: string, value: string, lineNumber?: number) => {
        commitScriptUpdate(base => updateDslObjectLabel(base, name, value, { lineNumber })?.script ?? null);
    }, [commitScriptUpdate]);

    // 进入画布点选：点到的点以 `sign` 指定的方向追加到现有截止点后面。
    // 一次只收一个点，收完就退出 —— 否则下一次点击拿到的还是旧脚本里的值，
    // 会把刚写进去的截止点覆盖掉。
    const handlePickCutPoint = useCallback((name: string, sign: '+' | '-') => {
        setCutPointPick({ objectName: name, sign });
    }, []);

    const handleCancelCutPointPick = useCallback(() => setCutPointPick(null), []);

    const handleCutPointPicked = useCallback((pointName: string) => {
        const request = cutPointPick;
        setCutPointPick(null);
        if (!request) return;
        const target = variables.find(item => item.name === request.objectName);
        const property = target?.editableCutPoints;
        // 同一个点只保留最后一次的方向，避免出现 `+A,-A` 这种互相抵消的写法。
        const entries = (property?.value ?? '')
            .split(',')
            .map(entry => entry.trim())
            .filter(Boolean)
            .filter(entry => entry.replace(/^[+-]\s*/, '') !== pointName);
        entries.push(`${request.sign}${pointName}`);
        handleCutPointsChange(request.objectName, entries.join(','), property?.lineNumber);
    }, [cutPointPick, variables, handleCutPointsChange]);

    // 把直线/射线/线段裁掉某一侧。新的实现会把「截止点数组」写回原对象定义，
    // 由原对象绘制时跳过对应区间，不再覆盖原线，也不再创建背景色遮罩。
    const handleLinearTrim = useCallback((
        rewrite: LinearTrimRewrite,
        commands: ReadonlyArray<TopLevelCommandInfo>,
    ) => {
        commitScriptUpdate(base => rewriteLinearDefinition(base, commands, rewrite));
    }, [commitScriptUpdate]);

    const handleToggleRandomVariable = useCallback((name: string, frozen: boolean) => {
        setFrozenRandomVariables(previous => {
            const next = { ...previous };
            if (frozen) {
                const variable = variables.find(item => item.name === name);
                if (variable && typeof variable.value === 'number') {
                    next[name] = variable.value;
                }
            } else {
                delete next[name];
            }
            return next;
        });
    }, [variables]);

    const handleToggleRandomObject = useCallback((name: string, frozen: boolean) => {
        setFrozenRandomObjects(previous => {
            const next = { ...previous };
            if (frozen) {
                const object = variables.find(item => item.name === name && item.randomObject);
                const x = object?.details?.['position.x'];
                const y = object?.details?.['position.y'];
                if (x !== undefined && y !== undefined) {
                    next[name] = { x: Number(x), y: Number(y) };
                }
            } else {
                delete next[name];
            }
            return next;
        });
    }, [variables]);

    const handleGeometryMessage = useCallback((level: string, line: number, message: string) => {
        const newMessage: LogMessage = {
            id: messageIdCounter.current++,
            level,
            line,
            message
        };
        // 使用函数式更新来安全地追加新消息
        setLogMessages(prevMessages => [...prevMessages, newMessage]);
    }, []);

    return (
        <PageContainer>
            <IntegratedWorkspace>
                <TabsPanel >
                    <ScriptTreePanel
                        title='ScriptFiles'
                        files={files}
                        activeFileId={activeFileId}
                        onFilesChange={handleFilesChange}
                        onSelectFile={handleSelectFile}
                    />
                    <ScriptInputPanel
                        title="Script Input"
                        script={script}
                        onScriptChange={handleScriptChange}
                        onExecute={handleExecuteScript}
                        onSave={handleSaveScript}
                        saveStatus={saveStatus}
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
                            frozenRandomVariables={frozenRandomVariables}
                            frozenRandomObjects={frozenRandomObjects}
                            selectedObjectNames={selectedObjectNames}
                            selectedLabelId={selectedLabelId}
                            labelPositions={labelPositions}
                            onSelectObject={handleCanvasSelectObject}
                            onSelectLabel={handleCanvasSelectLabel}
                            onLabelPositionChange={handleLabelPositionChange}
                            onObjectPropertyChange={handleObjectPropertyChange}
                            onLabelChange={handleLabelChange}
                            onGeometryCommands={handleGeometryCommands}
                            onDeleteObjects={handleDeleteObjects}
                            onLinearTrim={handleLinearTrim}
                            cutPointPick={cutPointPick}
                            onCutPointPicked={handleCutPointPicked}
                            onCancelCutPointPick={handleCancelCutPointPick}
                            onVariablesChange={handleVariablesChange}
                        />
                    )}
                </CanvasWrapper>

                <OutputPanel
                    title="Output Panel"
                    logs={logMessages}
                    variables={variables}
                    onToggleRandomVariable={handleToggleRandomVariable}
                    onToggleRandomObject={handleToggleRandomObject}
                    onTogglePointFrozen={handleTogglePointFrozen}
                    selectedObjectName={selectedObjectName}
                    onSelectObject={handleCanvasSelectObject}
                    onObjectPropertyChange={handleObjectPropertyChange}
                    onCutPointsChange={handleCutPointsChange}
                    onLabelChange={handleLabelChange}
                    onPickCutPoint={handlePickCutPoint}
                />
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