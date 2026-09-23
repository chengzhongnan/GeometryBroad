import React, { useState, useRef, useCallback } from 'react';
import styled from 'styled-components';

import TabsPanel from './TabsPanel';
import AIChatPanel from './AIChatPanel';
import ScriptInputPanel from './ScriptInputPanel';
import OutputPanel, { type LogMessage } from './OutputPanel';
import GeometricCanvas from './GeometryCanvas';
import type { GeometryOperation } from './GeometryCanvas';
import ScriptTreePanel from './ScriptTreePanel';
import type { FileNodeData } from './TreeNode';

import { useContainerSize } from '../hooks/useContainerSize';

import { INITIAL_USER_INPUT } from './InitScript';
import type { VariableInfo } from '../core/DSLInterpreter';
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
    // 使用 useRef 来为每条消息生成一个唯一的ID，避免不必要的重渲染
    const messageIdCounter = useRef(0);

    const [script, setScript] = useState<string>(() => {
        const savedScript = localStorage.getItem(SCRIPT_STORAGE_KEY);
        // 如果 localStorage 中有保存的脚本，则使用它，否则使用初始默认脚本
        return savedScript || INITIAL_USER_INPUT;
    });

    const handleSelectFile = useCallback((file: FileNodeData) => {
        if (file.type !== 'file') return;
        setActiveFileId(file.id);
        setScript(file.content || '');
        setSaveStatus('');
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
        setSelectedObjectNames([]);
    }, []);

    const handleLabelPositionChange = useCallback((labelId: string, position: IPoint) => {
        setLabelPositions(previous => ({
            ...previous,
            [labelId]: position,
        }));
    }, []);

    const handleGeometryOperation = useCallback((operation: GeometryOperation, objectNames: string[]) => {
        const makeUniqueName = (prefix: string) => {
            let candidate = prefix;
            let suffix = 2;
            while (script.includes(`name=${candidate}`)) {
                candidate = `${prefix}_${suffix++}`;
            }
            return candidate;
        };

        let command: string;
        if (operation === 'segment' || operation === 'line' || operation === 'perpBisector') {
            if (objectNames.length !== 2) return;
            const [p1, p2] = objectNames;
            const commandName = makeUniqueName(`${operation === 'segment' ? 'seg' : operation === 'line' ? 'line' : 'pb'}_${p1}_${p2}`);
            const commandType = operation === 'segment'
                ? 'SEGMENT'
                : operation === 'line'
                    ? 'LINE'
                    : 'PERP_BISECTOR';
            command = `CREATE ${commandType} name=${commandName} p1=${p1} p2=${p2} draw=true`;
        } else {
            if (objectNames.length !== 2) return;
            const pointName = objectNames.find(name => variables.find(variable => variable.name === name)?.objectType === 'point');
            const lineName = objectNames.find(name => {
                const type = variables.find(variable => variable.name === name)?.objectType;
                return type === 'line' || type === 'segment' || type === 'ray';
            });
            if (!pointName || !lineName) return;
            const commandName = makeUniqueName(`perp_${pointName}_${lineName}`);
            command = `CREATE PERPENDICULAR name=${commandName} point=${pointName} line=${lineName} draw=true`;
        }

        const nextScript = script.trim()
            ? `${script.trimEnd()}\n\n${command}`
            : command;
        setScript(nextScript);
        setGeneratedScript(nextScript);
        localStorage.setItem(SCRIPT_STORAGE_KEY, nextScript);
        setLogMessages([]);
        setRevision(previous => previous + 1);
    }, [script, variables]);

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
                        onScriptChange={setScript}
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
                            onGeometryOperation={handleGeometryOperation}
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
                    selectedObjectName={selectedObjectName}
                    onSelectObject={handleCanvasSelectObject}
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