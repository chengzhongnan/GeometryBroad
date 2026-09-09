import { useRef, useState, useLayoutEffect } from "react";

// --- 自定义Hook：用于获取容器的动态尺寸 ---
export function useContainerSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
    const ref = useRef<T>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // 我们使用 useLayoutEffect 是因为它会在浏览器绘制前同步执行，
    // 可以避免因尺寸变化导致的视觉闪烁。
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;

        // ResizeObserver 是监听元素尺寸变化的最佳方式
        const observer = new ResizeObserver(entries => {
            // 我们只观察一个元素，所以只关心第一个条目
            if (entries[0]) {
                const { width, height } = entries[0].contentRect;
                setDimensions({ width, height });
            }
        });

        observer.observe(element);

        // 组件卸载时，断开观察
        return () => observer.disconnect();
    }, []); // 空依赖数组意味着这个effect只在组件挂载时运行一次

    return [ref, dimensions];
}
