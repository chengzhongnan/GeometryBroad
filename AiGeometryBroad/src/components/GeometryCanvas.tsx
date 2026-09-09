import React, { useRef, useEffect, useCallback, useState } from 'react';
import styled from 'styled-components';
import { FiMaximize } from 'react-icons/fi';
import { GeometryDSLInterpreter } from '../core/DSLInterpreter';

interface GeometryCanvasProps {
    width: number;
    height: number;
    script: string;
    revision: number;
    onGeometryMessage: (level: string, line: number, message: string) => void;
    onClearMessage: () => void;
}

const GeometryCanvas: React.FC<GeometryCanvasProps> = ({ width, height, script, revision, onGeometryMessage, onClearMessage }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const interpreterRef = useRef<GeometryDSLInterpreter | null>(null);

    // 使用 Ref 来存储变换和拖动状态，避免不必要的组件重渲染
    const transformRef = useRef({ x: 0, y: 0, scale: 1 });
    const isDraggingRef = useRef(false);
    const lastMousePositionRef = useRef({ x: 0, y: 0 });

    // 使用 State 来更新UI上的缩放比例显示
    const [zoomLevel, setZoomLevel] = useState(1);

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
            // 清空输出消息
            onClearMessage();
            // 重新执行脚本
            interpreter.execute(script);
        } catch (error) {
            console.error("Error during redraw:", error);
        }
    }, [script]); // 依赖于 script，当脚本变化时，redraw 函数会更新

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

        const handleMouseDown = (e: MouseEvent) => {
            if (e.button === 0) { // 左键
                isDraggingRef.current = true;
                lastMousePositionRef.current = { x: e.clientX, y: e.clientY };
                canvas.style.cursor = 'grabbing';
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingRef.current) return;
            const deltaX = e.clientX - lastMousePositionRef.current.x;
            const deltaY = e.clientY - lastMousePositionRef.current.y;

            transformRef.current.x += deltaX;
            transformRef.current.y += deltaY;

            lastMousePositionRef.current = { x: e.clientX, y: e.clientY };
            redraw();
        };

        const handleMouseUpOrLeave = (e: MouseEvent) => {
            if (e.button === 0) {
                isDraggingRef.current = false;
                canvas.style.cursor = 'grab';
            }
        };

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();

            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const scaleFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const newScale = Math.max(0.1, Math.min(10, transformRef.current.scale * scaleFactor));

            const scaleChange = newScale / transformRef.current.scale;
            transformRef.current.x = mouseX - (mouseX - transformRef.current.x) * scaleChange;
            transformRef.current.y = mouseY - (mouseY - transformRef.current.y) * scaleChange;
            transformRef.current.scale = newScale;

            setZoomLevel(newScale);
            redraw();
        };

        canvas.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUpOrLeave);
        canvas.addEventListener('mouseleave', handleMouseUpOrLeave);
        canvas.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            canvas.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUpOrLeave);
            canvas.removeEventListener('mouseleave', handleMouseUpOrLeave);
            canvas.removeEventListener('wheel', handleWheel);
        };
    }, [redraw]); // 依赖于 redraw

    const handleResetView = () => {
        transformRef.current = { x: 0, y: 0, scale: 1 };
        setZoomLevel(1);
        redraw();
    };

    return (
        <CanvasContainer>
            <ControlsOverlay>
                <button onClick={handleResetView} title="Reset View">
                    <FiMaximize />
                </button>
                <span>{Math.round(zoomLevel * 100)}%</span>
            </ControlsOverlay>
            <canvas ref={canvasRef} width={width} height={height} />
        </CanvasContainer>
    );
};

const CanvasContainer = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  canvas {
    display: block;
    cursor: grab;
    &:active {
      cursor: grabbing;
    }
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

  button {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1.2rem;
    color: #333;
    display: flex;
    align-items: center;
    &:hover {
      color: #007aff;
    }
  }

  span {
    font-size: 0.8rem;
    color: #555;
    font-weight: 500;
    min-width: 50px;
  }
`;


export default GeometryCanvas;
