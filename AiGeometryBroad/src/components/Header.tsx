import React from 'react';
import styled from 'styled-components';

const Header: React.FC = () => {
  return (
    <HeaderContainer>
      <Logo>
        <span role="img" aria-label="logo">
          🧩
        </span>
        GeoBoard Pro
      </Logo>
      <HelpButton>Help</HelpButton>
    </HeaderContainer>
  );
};

// --- Styles ---
const HeaderContainer = styled.header`
  width: 100%;
  padding: 1rem 2rem;
  background-color: #ffffff;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
`;

const Logo = styled.div`
  font-size: 1.25rem;
  font-weight: 600;
  color: #2c3e50;

  span {
    margin-right: 0.5rem;
  }
`;

const HelpButton = styled.button`
  background-color: #ffffff;
  color: #3498db;
  border: 1px solid #3498db;
  padding: 0.5rem 1.5rem;
  border-radius: 5px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease-in-out;

  &:hover {
    background-color: #3498db;
    color: #ffffff;
  }
`;

export default Header;