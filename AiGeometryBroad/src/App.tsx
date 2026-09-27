// src/App.tsx
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';

import Header from './components/Header';
import MainContent from './components/MainContent';

import { GlobalStyle } from './styles/GlobalStyle';

function App() {
  // 「全屏作图」开关。状态放在 App 这一层，因为进全屏时连 Header 一起要藏起来。
  //
  // 这里**刻意不使用** Fullscreen API：用户要的是「普通窗口下画布等于浏览器窗口大小，
  // 按 F11 进浏览器全屏后画布等于整个屏幕」。用视口单位（100vw / 100vh）铺满布局，
  // 这两种情况天然都成立 —— 不需要额外监听 fullscreenchange，也不会和 F11 打架。
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(previous => !previous);
  }, []);

  // 全屏下按 Esc 退出。
  // 改标签 / 作图 / 插入文字这几个对话框，以及画布的截取、旋转、挑截止点模式都吃 Esc，
  // 它们处理时会调 preventDefault 标记「这次按键我用了」。这里延后一拍再判断，
  // 避免抢在它们前面把全屏一起退掉（监听器的注册顺序在这里靠不住）。
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      window.setTimeout(() => {
        if (!event.defaultPrevented) setIsFullscreen(false);
      }, 0);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  return (
    <AppContainer>
      <GlobalStyle />
      {!isFullscreen && <Header />}
      <MainContent isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />
    </AppContainer>
  );
}

const AppContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
`;

export default App;
