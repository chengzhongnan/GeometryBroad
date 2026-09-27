import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import styled from 'styled-components';
import { v4 as uuidv4 } from 'uuid';

import TabsPanel from './TabsPanel';
import AIChatPanel from './AIChatPanel';
import ScriptInputPanel from './ScriptInputPanel';
import OutputPanel, { type LogMessage } from './OutputPanel';
import GeometricCanvas, { type CutPointPickRequest } from './GeometryCanvas';
import ObjectEditDialog from './ObjectEditDialog';
import ScriptTreePanel from './ScriptTreePanel';
import type { FileNodeData } from './TreeNode';

import { useContainerSize } from '../hooks/useContainerSize';

import { INITIAL_USER_INPUT } from './InitScript';
import type { ObjectPropertyKey, TopLevelCommandInfo, VariableInfo } from '../core/DSLInterpreter';
import { updateDslObjectCutPoints, updateDslObjectFrozen, updateDslObjectLabel, updateDslObjectProperty, type PropertySyncOptions } from '../core/dslPropertySync';
import { removeObjectsFromScript, rewriteLinearDefinition, type LinearTrimRewrite } from '../core/dslObjectEditing';
import { removeTextLineFromScript, rewriteTextCommandLine } from '../core/textObjectEditing';
import type { CreateTextSpec } from '../core/geometryCommandBuilder';
import {
    createHistory,
    recordHistory,
    redoHistory,
    TYPING_COALESCE_KEY,
    undoHistory,
    type ScriptHistoryState,
    type ScriptSnapshot,
} from '../core/scriptHistory';
import {
    findParentFolderId,
    insertNodeIntoTree,
    nextSequentialFileName,
} from '../core/scriptFiles';
import type { IPoint } from '../core/geometry/base';

const SCRIPT_STORAGE_KEY = 'geo-script-last-code';
const FILES_STORAGE_KEY = 'geo-script-files';

// 没有选中对象时复用同一个空数组，避免每次渲染都造一个新引用 ——
// ScriptInputPanel 里那个「重算红点」的 effect 依赖它，新引用会让 effect 每次都跑。
const EMPTY_LINES: number[] = [];

// 「保存脚本」新建文件时用的前缀与扩展名：保存一次生成一个 `geo_1.geo`、`geo_2.geo`……
// 编号取当前文件树里尚未使用的下一个整数，保证不会重名。
const SAVED_FILE_PREFIX = 'geo';
const SAVED_FILE_EXTENSION = '.geo';

const DEFAULT_FILES: FileNodeData[] = [
    {
        id: '1',
        name: 'scripts',
        type: 'folder',
        children: [
            { id: '2', name: 'create_geometry.geo', type: 'file', content: INITIAL_USER_INPUT },
        ],
    },
    // 注意：这里是**真实的换行符**，不是字符串 "\n"。早先写成 '# GeometryBroad scripts\\n'
    // 会在编辑器里原样显示成一个反斜杠加 n，看着像乱码。
    { id: '4', name: 'README.md', type: 'file', content: '# GeometryBroad scripts\n' },
];

interface MainContentProps {
    /** 全屏作图模式：藏掉两侧面板和 Header，只留画布。由 App 统一持有，因为 Header 也在那一层。 */
    isFullscreen: boolean;
    onToggleFullscreen: () => void;
}

function MainContent({ isFullscreen, onToggleFullscreen }: MainContentProps) {

    const [userInput, setUserInput] = useState<string>(INITIAL_USER_INPUT);
    const [generatedScript, setGeneratedScript] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [revision, setRevision] = useState<number>(0);
    /**
     * 「重播延时动画」令牌。只有用户**主动重新运行脚本**（点 Execute / 撤销 / 重做）时才 +1。
     *
     * 为什么不复用 `revision`：`revision` 的语义是「强制重跑解释器」，凡是脚本内容变了
     * 都会 +1 —— 拖动一个点（`handleObjectPropertyChange`）、删对象都会。而 `ANIMATE`
     * 的延时动画只该在用户主动运行时从头放一遍；否则拖一下点、点一下对象，
     * 整幅图就会重新一个一个地画出来，完全没法用。
     *
     * 画布那侧拿它和「上次跑过的令牌」比对，只有变了才允许动画，见 GeometryCanvas 的 redraw。
     */
    const [animationToken, setAnimationToken] = useState<number>(0);
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
    /**
     * 「编辑对象」对话框要编辑的对象名。
     *
     * 存**名字**而不是对象快照：属性改完会重跑脚本，解释器吐出来的那份快照整个换新，
     * 存下来的旧快照会显示上一轮的数值。每次渲染都拿名字去 `variables` 里现查，
     * 这样面板、对话框、画布永远是同一份数据。
     */
    const [objectEditTarget, setObjectEditTarget] = useState<string | null>(null);
    /**
     * 「变量表里右键」发起的对象菜单请求。
     *
     * 菜单本身由画布渲染（只有它拿得到解释器），这里只负责把「给谁、弹在哪」传过去。
     * `id` 每次都变 —— 同一个对象连着右键两次也要重新弹。
     */
    const [objectMenuRequest, setObjectMenuRequest] = useState<{ id: number; names: string[]; x: number; y: number } | null>(null);
    const objectMenuRequestIdRef = useRef(0);
    /**
     * 主画布元素。由画布挂载后报上来，供「编辑对象」对话框复制像素当图形预览。
     * 存 state 而不是 ref：画布挂载完成时要触发一次重渲染，对话框才拿得到它。
     */
    const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
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
            // 撤销/重做回到的是另一份脚本，等于重新运行一次，延时动画可以再放一遍。
            setAnimationToken(previous => previous + 1);
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

    // 「保存脚本」= 另存为一份**新文件**：在文件树里按 `geo_<数字>` 命名建一个 .geo，
    // 内容就是当前脚本，并把它设为活动文件。
    //
    // 为什么不是「覆盖当前文件」：当前脚本往往是 AI 生成 / 临时试验的内容，
    // 直接盖掉已有文件容易误伤。另存一份新文件更安全，也符合截图里
    // 「Save Script → 左侧文件树多出一个脚本」的预期。
    // 新文件放进**当前活动文件所在的文件夹**（没有就放根层），并自动选中它。
    const handleSaveScript = useCallback(() => {
        localStorage.setItem(SCRIPT_STORAGE_KEY, script);

        const newFileName = nextSequentialFileName(files, SAVED_FILE_PREFIX, SAVED_FILE_EXTENSION);
        const parentFolderId = activeFileId ? findParentFolderId(files, activeFileId) : null;
        const newNode: FileNodeData = {
            id: uuidv4(),
            name: newFileName,
            type: 'file',
            content: script,
        };

        const nextFiles = insertNodeIntoTree(files, parentFolderId, newNode);
        setFiles(nextFiles);
        localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(nextFiles));

        // 保存后切到新文件：用户刚存完就能继续在它上面编辑，也便于确认存到哪了。
        setActiveFileId(newNode.id);
        setSaveStatus(`Saved ${newFileName}`);
        // 换了一份文档，历史清空 —— 否则在新文件里 Ctrl+Z 会倒灌上一个文件的内容。
        setHistory(createHistory());
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
        // 用户主动运行 —— 延时动画从这里重新开始放（重复点 Execute 也会重放）。
        setAnimationToken(previous => previous + 1);
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

    // 编辑/删除一段画布文字（TEXT）。
    //
    // TEXT 没有 `name=`，通用删除路径按名字找不到它，所以单独按**行号**定位。
    // 行号由画布在右键那一刻从解释器取好传上来（解释器里有唯一的真值），
    // 这里只负责落地改写，不再自己解析一遍脚本。
    const handleTextLineChange = useCallback((lineNumber: number, spec: CreateTextSpec) => {
        commitScriptUpdate(base => {
            const lines = base.split('\n');
            const index = lineNumber - 1;
            if (index < 0 || index >= lines.length) return null;
            const rewritten = rewriteTextCommandLine(lines[index], spec);
            if (rewritten === null) return null;
            const next = [...lines];
            next[index] = rewritten;
            return next.join('\n');
        });
    }, [commitScriptUpdate]);

    const handleDeleteText = useCallback((lineNumber: number) => {
        commitScriptUpdate(base => removeTextLineFromScript(base, lineNumber));
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

    // ---- 「编辑对象」对话框 ----
    // 每次渲染都按名字现查，而不是把快照存进 state：属性一改就会重跑脚本，
    // 解释器吐出来的那份快照整个换新，存下来的旧快照会显示上一轮的数值。
    const objectEditValue = objectEditTarget
        ? variables.find(item => item.name === objectEditTarget) ?? null
        : null;

    const handleRequestObjectEdit = useCallback((name: string) => {
        setObjectEditTarget(name);
    }, []);

    /**
     * 变量表里在某个对象上右键：请画布弹同一个对象菜单。
     *
     * 选中规则和画布上右键保持一致：点到的对象**已经在选中集合里**就用整个集合，
     * 否则把它设为唯一选中 —— 否则「先多选、再右键其中一个」会把刚选好的集合冲掉。
     */
    const handleRequestObjectMenu = useCallback((name: string, clientX: number, clientY: number) => {
        const alreadySelected = selectedObjectNames.includes(name);
        const names = alreadySelected ? selectedObjectNames : [name];
        if (!alreadySelected) handleCanvasSelectObject(name);
        objectMenuRequestIdRef.current += 1;
        setObjectMenuRequest({ id: objectMenuRequestIdRef.current, names, x: clientX, y: clientY });
    }, [selectedObjectNames, handleCanvasSelectObject]);

    /**
     * 对话框里点「± 点选」。
     *
     * **必须先关掉对话框**：它是模态的，遮罩挡住整个画布，不关就没法去画布上点。
     * 点完把点写回 cutPoints 之后，用户想接着看结果可以再右键打开一次。
     */
    const handleDialogPickCutPoint = useCallback((name: string, sign: '+' | '-') => {
        setObjectEditTarget(null);
        handlePickCutPoint(name, sign);
    }, [handlePickCutPoint]);

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

    // 把直线/射线/线段裁掉某一侧。实现是把「截止点数组」写回原对象定义，
    // 由原对象绘制时跳过对应区间，不覆盖原线、也不创建背景色遮罩。
    //
    // 无界尾部（`−∞ → A` / `B → +∞`）删的是整条尾巴：planner 直接省掉无界那一侧的
    // token，不生成任何新点，所以这里只需要改定义行这一处。
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

    // 选中对象 → 编辑器里要打红点的行号。
    //
    // 用 variables 里已经带上的 sourceLines，而不是去问画布的解释器实例：
    // 解释器是画布的内部状态，跨组件伸手进去会把「谁拥有渲染状态」这条界线弄糊；
    // 而 variables 本来就是解释器渲染完吐出来的快照，里面已经含了同一份行号。
    //
    // 多选时把每个对象的行号并起来 —— 用户框选一组对象，就该看到这一组定义在哪。
    const highlightLines = useMemo(() => {
        if (selectedObjectNames.length === 0) return EMPTY_LINES;
        const lines = new Set<number>();
        for (const name of selectedObjectNames) {
            const variable = variables.find(item => item.name === name);
            for (const line of variable?.sourceLines ?? []) lines.add(line);
        }
        return [...lines].sort((a, b) => a - b);
    }, [selectedObjectNames, variables]);

    const handleGeometryMessage = useCallback((level: string, line: number, message: string) => {        const newMessage: LogMessage = {
            id: messageIdCounter.current++,
            level,
            line,
            message
        };
        // 使用函数式更新来安全地追加新消息
        setLogMessages(prevMessages => [...prevMessages, newMessage]);
    }, []);

    return (
        <PageContainer $fullscreen={isFullscreen}>
            <IntegratedWorkspace $fullscreen={isFullscreen}>
                {/* 面板用 PanelSlot 包一层，靠 CSS 隐藏而不是条件渲染 ——
                    组件仍留在树上，面板内部状态（AI 对话记录、当前页签、编辑器光标）不会因为
                    进出全屏而丢掉。display: contents 时这层盒子不存在，两个面板照旧是
                    IntegratedWorkspace 的直接 flex 子项。 */}
                <PanelSlot $hidden={isFullscreen}>
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
                            highlightLines={highlightLines}
                        />
                        <AIChatPanel
                            title='AI Chat'
                        />
                    </TabsPanel>
                </PanelSlot>

                <CanvasWrapper ref={canvasWrapperRef}>
                    {canvasDimensions.width > 0 && canvasDimensions.height > 0 && (
                        <GeometricCanvas
                            width={canvasDimensions.width}
                            height={canvasDimensions.height}
                            isFullscreen={isFullscreen}
                            onToggleFullscreen={onToggleFullscreen}
                            onExecute={handleExecuteScript}
                            onRequestObjectEdit={handleRequestObjectEdit}
                            objectMenuRequest={objectMenuRequest}
                            onCanvasReady={setCanvasElement}
                            animationToken={animationToken}
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
                            onTextLineChange={handleTextLineChange}
                            onDeleteText={handleDeleteText}
                            onLinearTrim={handleLinearTrim}
                            cutPointPick={cutPointPick}
                            onCutPointPicked={handleCutPointPicked}
                            onCancelCutPointPick={handleCancelCutPointPick}
                            onVariablesChange={handleVariablesChange}
                        />
                    )}
                </CanvasWrapper>

                <PanelSlot $hidden={isFullscreen}>
                    <OutputPanel
                        title="Output Panel"
                        logs={logMessages}
                        variables={variables}
                        onToggleRandomVariable={handleToggleRandomVariable}
                        onToggleRandomObject={handleToggleRandomObject}
                        onTogglePointFrozen={handleTogglePointFrozen}
                        selectedObjectName={selectedObjectName}
                        selectedObjectNames={selectedObjectNames}
                        onSelectObject={handleCanvasSelectObject}
                        onRequestObjectMenu={handleRequestObjectMenu}
                        onObjectPropertyChange={handleObjectPropertyChange}
                        onCutPointsChange={handleCutPointsChange}
                        onLabelChange={handleLabelChange}
                        onPickCutPoint={handlePickCutPoint}
                    />
                </PanelSlot>
            </IntegratedWorkspace>

            {/* 「编辑对象」对话框。放在这一层是因为它要的 `variables` 和那几个写回脚本的回调
                本来就都在这里（右侧面板用的就是同一批）—— 画布不必为此再维护一份。
                对象被删掉 / 脚本重跑后它不存在了就不渲染，对话框自然消失。 */}
            {objectEditValue && (
                <ObjectEditDialog
                    object={objectEditValue}
                    sourceCanvas={canvasElement}
                    // 和画布同尺寸：对话框里的图形是主画布的像素副本，两边尺寸必须一致，
                    // 否则贴上去会被拉伸。
                    canvasWidth={canvasDimensions.width}
                    canvasHeight={canvasDimensions.height}
                    handlers={{
                        onObjectPropertyChange: handleObjectPropertyChange,
                        onCutPointsChange: handleCutPointsChange,
                        onLabelChange: handleLabelChange,
                        onPickCutPoint: handleDialogPickCutPoint,
                    }}
                    onTogglePointFrozen={handleTogglePointFrozen}
                    onToggleRandomObject={handleToggleRandomObject}
                    onClose={() => setObjectEditTarget(null)}
                />
            )}
        </PageContainer>
    );
}

// 页面容器，现在的主要职责是提供背景色并将工作区居中
const PageContainer = styled.div<{ $fullscreen?: boolean }>`
  display: flex;
  justify-content: center; /* 水平居中 */
  align-items: center; /* 垂直居中 */
  /* 全屏时去掉所有留白，让画布真的贴满视口 */
  padding: ${({ $fullscreen }) => ($fullscreen ? '0' : '2rem')};
  
  /* 普通模式给 Header 让出 80px；全屏模式 Header 已隐藏，容器直接吃满整屏 */
  height: ${({ $fullscreen }) => ($fullscreen ? '100vh' : 'calc(100vh - 80px)')};
  width: 100%;
  box-sizing: border-box;
  background-color: ${({ $fullscreen }) => ($fullscreen ? '#ffffff' : '#f4f7fc')};
`;

// 新增的整合式工作区，这是一个“卡片”
const IntegratedWorkspace = styled.div<{ $fullscreen?: boolean }>`
  display: flex;
  align-items: stretch;
  gap: ${({ $fullscreen }) => ($fullscreen ? '0' : '1.5rem')}; /* 全屏只剩一个子项，间距无意义 */
  
  width: 100%;
  /* 全屏时解除 1700px / 1200px 的封顶，否则大屏上画布反而比窗口小 */
  max-width: ${({ $fullscreen }) => ($fullscreen ? 'none' : '1700px')};
  height: ${({ $fullscreen }) => ($fullscreen ? '100%' : '95%')};
  max-height: ${({ $fullscreen }) => ($fullscreen ? 'none' : '1200px')};

  padding: ${({ $fullscreen }) => ($fullscreen ? '0' : '1.5rem')};
  background-color: #ffffff;
  /* 全屏时不要圆角和阴影，画布边界就是屏幕边界 */
  border-radius: ${({ $fullscreen }) => ($fullscreen ? '0' : '16px')};
  box-shadow: ${({ $fullscreen }) => ($fullscreen ? 'none' : '0 10px 40px rgba(0, 0, 0, 0.08)')};
  box-sizing: border-box;
`;

// 面板插槽。平时 display: contents —— 盒子不参与布局，里面的面板照旧是
// IntegratedWorkspace 的直接 flex 子项，宽度/收缩行为和以前完全一致；
// 全屏时改成 display: none 把面板藏掉，但组件仍挂在 React 树上（状态不丢）。
const PanelSlot = styled.div<{ $hidden?: boolean }>`
  display: ${({ $hidden }) => ($hidden ? 'none' : 'contents')};
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