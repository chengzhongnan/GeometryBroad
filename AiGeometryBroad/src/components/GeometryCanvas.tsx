import React, { useRef, useEffect, useCallback, useState } from 'react';
import styled from 'styled-components';
import { FiMaximize, FiDownload, FiCopy, FiLock, FiUnlock } from 'react-icons/fi';
import { GeometryDSLInterpreter, type VariableInfo, type CanvasSelection } from '../core/DSLInterpreter';
import type { IPoint } from '../core/geometry/base';
import { exportScriptToSvg, downloadSvg, copySvgToClipboard } from '../core/svgExport';
import { subscribeKatexUpdates } from '../core/katexRender';

export type GeometryOperation = 'segment' | 'line' | 'perpBisector' | 'perpendicular';

interface ContextMenuItem {
    id: GeometryOperation | 'none';
    label: string;
    operation?: GeometryOperation;
    disabled?: boolean;
}

interface ContextMenuState {
    x: number;
    y: number;
    objectNames: string[];
    items: ContextMenuItem[];
}

interface GeometryCanvasProps {
    width: number;
    height: number;
    script: string;
    revision: number;
    onGeometryMessage: (level: string, line: number, message: string) => void;
    onClearMessage: () => void;
    frozenRandomVariables: Record<string, number>;
    frozenRandomObjects: Record<string, { x: number; y: number }>;
    selectedObjectNames: string[];
    selectedLabelId: string | null;
    labelPositions: Record<string, IPoint>;
    onSelectObject: (name: string | null, additive?: boolean) => void;
    onSelectLabel: (id: string | null) => void;
    onLabelPositionChange: (id: string, position: IPoint) => void;
    onGeometryOperation: (operation: GeometryOperation, objectNames: string[]) => void;
    onVariablesChange: (variables: VariableInfo[]) => void;
}

const GeometryCanvas: React.FC<GeometryCanvasProps> = ({ width, height, script, revision, onGeometryMessage, onClearMessage, frozenRandomVariables, frozenRandomObjects, selectedObjectNames, selectedLabelId, labelPositions, onSelectObject, onSelectLabel, onLabelPositionChange, onGeometryOperation, onVariablesChange }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const interpreterRef = useRef<GeometryDSLInterpreter | null>(null);

    // 使用 Ref 来存储变换和拖动状态，避免不必要的组件重渲染
    const transformRef = useRef({ x: 0, y: 0, scale: 1 });
    const isDraggingRef = useRef(false);
    const lastCanvasPositionRef = useRef({ x: 0, y: 0 });
    const pointerDownPositionRef = useRef({ x: 0, y: 0 });
    const hasDraggedRef = useRef(false);
    const isLockedRef = useRef(false);
    const activeSelectionRef = useRef<CanvasSelection>(null);
    const labelDragOffsetRef = useRef({ x: 0, y: 0 });
    const isLabelDraggingRef = useRef(false);
    const suppressClickRef = useRef(false);

    // 开锁：编辑、选择和拖动标签；闭锁：移动绘图区和缩放。
    const [isLocked, setIsLocked] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    // KaTeX 异步缓存命中后会通过订阅通知这里，每次通知都让 redraw 重新执行
    // 一次脚本，把缓存好的 LaTeX 离屏 canvas 贴回主画布。
    const [katexTick, setKatexTick] = useState(0);
    const redrawRef = useRef<() => void>(() => {});

    // 使用 useCallback 封装重绘逻辑，以便在多个 Effect 中稳定引用
    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        const interpreter = interpreterRef.current;
        if (!canvas || !interpreter) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 1. 重置变换矩阵，清空画布
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 2. 应用新的变换矩阵
        ctx.setTransform(transformRef.current.scale, 0, 0, transformRef.current.scale, transformRef.current.x, transformRef.current.y);

        // 3. 重新执行脚本进行绘制
        try {
            // 更新变换信息到DSL引擎
            interpreter.setTransform(canvas, transformRef.current);
            interpreter.setFrozenRandomVariables(frozenRandomVariables);
            interpreter.setFrozenRandomObjects(frozenRandomObjects);
            interpreter.setSelectedObjectNames(selectedObjectNames);
            interpreter.setSelectedLabelId(selectedLabelId);
            interpreter.setLabelPositions(labelPositions);
            // 清空输出消息
            onClearMessage();
            // 重新执行脚本
            interpreter.execute(script);
            onVariablesChange(interpreter.getVariables());
        } catch (error) {
            console.error("Error during redraw:", error);
        }
    }, [script, frozenRandomVariables, frozenRandomObjects, selectedObjectNames, selectedLabelId, labelPositions, onVariablesChange, katexTick]); // 选中对象、标签位置或固定状态变化时重绘

    // 保持最新 redraw 的引用，给 KaTeX 订阅回调调用，避免闭包过期
    useEffect(() => {
        redrawRef.current = redraw;
    }, [redraw]);

    // 订阅 KaTeX 异步缓存完成事件：缓存命中后再次重绘，把 LaTeX 贴回画布
    useEffect(() => {
        const unsubscribe = subscribeKatexUpdates(() => {
            setKatexTick((tick) => tick + 1);
        });
        return unsubscribe;
    }, []);

    // Effect for initializing the interpreter
    useEffect(() => {
        if (!interpreterRef.current && canvasRef.current) {
            interpreterRef.current = new GeometryDSLInterpreter(canvasRef.current, onGeometryMessage);
        }
    }, [onGeometryMessage]);

    // Effect for redrawing when external props change
    useEffect(() => {
        if (interpreterRef.current && canvasRef.current) {
            interpreterRef.current.setCanvas(canvasRef.current);
            redraw();
        }
    }, [width, height, script, revision, redraw]);

    // Effect for setting up and cleaning up event listeners
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        isLockedRef.current = isLocked;
        canvas.style.cursor = isLocked ? 'grab' : 'default';

        const handleMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            setContextMenu(null);
            pointerDownPositionRef.current = { x: e.clientX, y: e.clientY };
            lastCanvasPositionRef.current = getCanvasPoint(e);
            hasDraggedRef.current = false;
            isLabelDraggingRef.current = false;
            activeSelectionRef.current = null;

            if (!isLockedRef.current && interpreterRef.current) {
                const point = getCanvasPoint(e);
                activeSelectionRef.current = interpreterRef.current.hitTestSelection(
                    point.x,
                    point.y,
                    12,
                    transformRef.current,
                );
                if (activeSelectionRef.current?.kind === 'label') {
                    labelDragOffsetRef.current = {
                        x: point.x - activeSelectionRef.current.screenAnchor.x,
                        y: point.y - activeSelectionRef.current.screenAnchor.y,
                    };
                }
            }

            // 闭锁状态下左键拖动视图；开锁状态下只有标签拖动才进入拖动流程。
            isDraggingRef.current = isLockedRef.current || activeSelectionRef.current?.kind === 'label';
            canvas.style.cursor = isLockedRef.current ? 'grabbing' : 'pointer';
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingRef.current) {
                if (!isLockedRef.current && interpreterRef.current) {
                    const point = getCanvasPoint(e);
                    const hoverSelection = interpreterRef.current.hitTestSelection(point.x, point.y, 12, transformRef.current);
                    canvas.style.cursor = hoverSelection?.kind === 'label'
                        ? 'grab'
                        : hoverSelection?.kind === 'object'
                            ? 'pointer'
                            : 'default';
                }
                return;
            }
            const totalDistance = Math.hypot(
                e.clientX - pointerDownPositionRef.current.x,
                e.clientY - pointerDownPositionRef.current.y,
            );
            if (totalDistance > 4) hasDraggedRef.current = true;

            if (!isLockedRef.current) {
                const activeSelection = activeSelectionRef.current;
                if (activeSelection?.kind !== 'label' || totalDistance <= 4 || !interpreterRef.current) return;
                const point = getCanvasPoint(e);
                const adjustedPoint = {
                    x: point.x - labelDragOffsetRef.current.x,
                    y: point.y - labelDragOffsetRef.current.y,
                };
                const logicalPosition = interpreterRef.current.screenToLogicalPoint(adjustedPoint.x, adjustedPoint.y, transformRef.current);
                if (!logicalPosition) return;
                isLabelDraggingRef.current = true;
                onSelectLabel(activeSelection.id);
                onLabelPositionChange(activeSelection.id, logicalPosition);
                return;
            }

            const currentCanvasPoint = getCanvasPoint(e);
            const deltaX = currentCanvasPoint.x - lastCanvasPositionRef.current.x;
            const deltaY = currentCanvasPoint.y - lastCanvasPositionRef.current.y;
            transformRef.current.x += deltaX;
            transformRef.current.y += deltaY;
            lastCanvasPositionRef.current = currentCanvasPoint;
            redraw();
        };

        const handleMouseUp = (e: MouseEvent) => {
            if (e.button !== 0) return;
            if (isLabelDraggingRef.current) suppressClickRef.current = true;
            isDraggingRef.current = false;
            activeSelectionRef.current = null;
            isLabelDraggingRef.current = false;
            canvas.style.cursor = isLockedRef.current ? 'grab' : 'default';
        };

        const getCanvasPoint = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            // Canvas 的 CSS 尺寸可能与 width/height 属性不同，命中检测统一换算到画布像素。
            const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
            const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY,
            };
        };

        // 使用 click 处理开锁模式的选择，避免依赖 window mouseup 在某些浏览器中丢失。
        const handleCanvasClick = (e: MouseEvent) => {
            setContextMenu(null);
            if (isLockedRef.current || !interpreterRef.current) return;
            if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
            }
            const point = getCanvasPoint(e);
            const selection = interpreterRef.current.hitTestSelection(
                point.x,
                point.y,
                12,
                transformRef.current,
            );
            if (!selection) {
                onSelectObject(null);
                onSelectLabel(null);
            } else if (selection.kind === 'label') {
                onSelectLabel(selection.id);
                onSelectObject(null);
            } else {
                onSelectObject(selection.name, e.ctrlKey || e.metaKey);
                onSelectLabel(null);
            }
        };

        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            if (isLockedRef.current || !interpreterRef.current) return;

            const point = getCanvasPoint(e);
            const hit = interpreterRef.current.hitTestSelection(point.x, point.y, 12, transformRef.current);
            let objectNames = [...selectedObjectNames];
            if (hit?.kind === 'object' && !objectNames.includes(hit.name)) {
                const additive = e.ctrlKey || e.metaKey;
                objectNames = additive ? [...objectNames, hit.name] : [hit.name];
                onSelectObject(hit.name, additive);
            }

            if (objectNames.length === 0) return;
            const objects = objectNames
                .map(name => interpreterRef.current?.getObject(name))
                .filter(Boolean);
            const pointNames = objects.filter(object => object?.type === 'point').map(object => object!.name);
            const linearNames = objects
                .filter(object => object?.type === 'line' || object?.type === 'segment' || object?.type === 'ray')
                .map(object => object!.name);

            let items: ContextMenuItem[];
            if (objectNames.length === 2 && pointNames.length === 2) {
                items = [
                    { id: 'segment', label: '连接线段', operation: 'segment' },
                    { id: 'line', label: '连接直线', operation: 'line' },
                    { id: 'perpBisector', label: '作垂直平分线', operation: 'perpBisector' },
                ];
            } else if (objectNames.length === 2 && pointNames.length === 1 && linearNames.length === 1) {
                items = [
                    { id: 'perpendicular', label: '过点作垂线', operation: 'perpendicular' },
                ];
            } else {
                items = [{ id: 'none', label: `当前选择 ${objectNames.length} 个对象，暂无可用操作`, disabled: true }];
            }

            const bounds = canvas.parentElement?.getBoundingClientRect() || canvas.getBoundingClientRect();
            setContextMenu({
                x: e.clientX - bounds.left,
                y: e.clientY - bounds.top,
                objectNames,
                items,
            });
        };

        const handleWheel = (e: WheelEvent) => {
            if (!isLockedRef.current) return;
            e.preventDefault();

            const wheelPoint = getCanvasPoint(e);
            const mouseX = wheelPoint.x;
            const mouseY = wheelPoint.y;

            const scaleFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const newScale = Math.max(0.1, Math.min(10, transformRef.current.scale * scaleFactor));

            const scaleChange = newScale / transformRef.current.scale;
            transformRef.current.x = mouseX - (mouseX - transformRef.current.x) * scaleChange;
            transformRef.current.y = mouseY - (mouseY - transformRef.current.y) * scaleChange;
            transformRef.current.scale = newScale;
            redraw();
        };

        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('click', handleCanvasClick);
        canvas.addEventListener('contextmenu', handleContextMenu);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            canvas.removeEventListener('mousedown', handleMouseDown);
            canvas.removeEventListener('click', handleCanvasClick);
            canvas.removeEventListener('contextmenu', handleContextMenu);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            canvas.removeEventListener('wheel', handleWheel);
        };
    }, [isLocked, onSelectObject, onSelectLabel, onLabelPositionChange, redraw]);

    const handleResetView = () => {
        transformRef.current = { x: 0, y: 0, scale: 1 };
        redraw();
    };

    // 生成 SVG 源码，并复用当前画布的缩放/平移视图。
    // 这样用户在画布中放大到 500% 后导出的 SVG 也会保留该视图状态。
    const buildSvg = () => exportScriptToSvg(script, {
        width,
        height,
        view: {
            scale: transformRef.current.scale,
            offsetX: transformRef.current.x,
            offsetY: transformRef.current.y,
        },
    });

    const handleExportSvg = () => {
        try {
            const svg = buildSvg();
            downloadSvg(svg, /CREATE\s+ANIMATION/i.test(script) ? 'geometry-animation.svg' : 'geometry.svg');
        } catch (error) {
            console.error('Failed to export SVG:', error);
        }
    };

    const handleCopySvg = async () => {
        try {
            const svg = buildSvg();
            await copySvgToClipboard(svg);
        } catch (error) {
            console.error('Failed to copy SVG:', error);
        }
    };

    return (
        <CanvasContainer>
            <ControlsOverlay>
                <IconButton onClick={() => setIsLocked(previous => !previous)} title={isLocked ? '闭锁：拖动和缩放绘图区；点击解锁后编辑元素' : '开锁：选择和编辑元素；点击闭锁后移动和缩放视图'} aria-label={isLocked ? '解锁编辑模式' : '锁定视图模式'} aria-pressed={isLocked} $active={isLocked}>
                    {isLocked ? <FiLock /> : <FiUnlock />}
                </IconButton>
                <IconButton onClick={handleResetView} title="重置视图" aria-label="重置视图">
                    <FiMaximize />
                </IconButton>
                <IconButton onClick={handleExportSvg} title="导出 SVG 文件" aria-label="导出 SVG 文件">
                    <FiDownload />
                </IconButton>
                <IconButton onClick={handleCopySvg} title="复制 SVG 代码" aria-label="复制 SVG 代码">
                    <FiCopy />
                </IconButton>
            </ControlsOverlay>
            <canvas ref={canvasRef} width={width} height={height} />
            {contextMenu && (
                <ContextMenu
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onMouseDown={event => event.stopPropagation()}
                >
                    <ContextMenuTitle>{contextMenu.objectNames.length} 个对象</ContextMenuTitle>
                    {contextMenu.items.map(item => (
                        <ContextMenuItemButton
                            key={item.id}
                            type="button"
                            disabled={item.disabled}
                            onClick={() => {
                                if (item.operation) {
                                    onGeometryOperation(item.operation, contextMenu.objectNames);
                                }
                                setContextMenu(null);
                            }}
                        >
                            {item.label}
                        </ContextMenuItemButton>
                    ))}
                </ContextMenu>
            )}
        </CanvasContainer>
    );
};

const CanvasContainer = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  canvas {
    display: block;
  }
`;

const ContextMenu = styled.div`
  position: absolute;
  min-width: 180px;
  padding: 6px;
  background: #ffffff;
  border: 1px solid #d7dce5;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  z-index: 30;
`;

const ContextMenuTitle = styled.div`
  padding: 6px 9px;
  color: #64748b;
  font-size: 0.72rem;
  border-bottom: 1px solid #eef1f5;
`;

const ContextMenuItemButton = styled.button`
  display: block;
  width: 100%;
  padding: 8px 9px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
  font-size: 0.8rem;

  &:hover:not(:disabled) {
    background: #eff6ff;
    color: #2563eb;
  }

  &:disabled {
    color: #94a3b8;
    cursor: default;
  }
`;

const ControlsOverlay = styled.div`
  position: absolute;
  top: 10px;
  right: 10px;
  background-color: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(5px);
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 8px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);

`;

interface IconButtonProps {
  $active?: boolean;
}

const IconButton = styled.button<IconButtonProps>`
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: ${({ $active }) => $active ? 'rgba(225, 29, 72, 0.12)' : 'transparent'};
  color: ${({ $active }) => $active ? '#e11d48' : '#333'};
  cursor: pointer;
  font-size: 1.15rem;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background-color: rgba(0, 122, 255, 0.1);
    color: #007aff;
  }
`;


export default GeometryCanvas;
