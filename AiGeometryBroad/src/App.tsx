// src/App.tsx
import React from 'react';
import styled from 'styled-components';

import Header from './components/Header';
import MainContent from './components/MainContent';

import { GlobalStyle } from './styles/GlobalStyle';

function App() {
  return (
    <AppContainer>
      <GlobalStyle />
      <Header />
      <MainContent />
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