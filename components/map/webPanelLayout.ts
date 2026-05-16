export const WEB_PANEL_MARGIN = 12;
export const WEB_PANEL_GAP = 12;
export const WEB_SIDEBAR_BREAKPOINT = 920;

const WEB_SIDEBAR_MIN_WIDTH = 340;
const WEB_SIDEBAR_MAX_WIDTH = 420;
const WEB_SIDEBAR_WIDTH_RATIO = 0.3;

const WEB_BOTTOM_PANEL_MIN_HEIGHT = 260;
const WEB_BOTTOM_PANEL_MAX_HEIGHT = 380;
const WEB_BOTTOM_PANEL_HEIGHT_RATIO = 0.34;

export function getWebSidebarWidth(screenWidth: number): number {
  if (screenWidth < WEB_SIDEBAR_BREAKPOINT) return 0;
  return Math.round(
    Math.min(
      WEB_SIDEBAR_MAX_WIDTH,
      Math.max(WEB_SIDEBAR_MIN_WIDTH, screenWidth * WEB_SIDEBAR_WIDTH_RATIO),
    ),
  );
}

export function getWebBottomPanelHeight(screenHeight: number, safeBottom = 0): number {
  return (
    Math.round(
      Math.min(
        WEB_BOTTOM_PANEL_MAX_HEIGHT,
        Math.max(WEB_BOTTOM_PANEL_MIN_HEIGHT, screenHeight * WEB_BOTTOM_PANEL_HEIGHT_RATIO),
      ),
    ) + safeBottom
  );
}

export function getWebBottomPanelRightInset(screenWidth: number): number {
  const sidebarWidth = getWebSidebarWidth(screenWidth);
  return sidebarWidth > 0 ? sidebarWidth + WEB_PANEL_MARGIN + WEB_PANEL_GAP : WEB_PANEL_MARGIN;
}

export function getWebMapCameraPadding(screenWidth: number, screenHeight: number, safeBottom = 0) {
  const sidebarWidth = getWebSidebarWidth(screenWidth);
  return {
    paddingTop: WEB_PANEL_MARGIN,
    paddingLeft: WEB_PANEL_MARGIN,
    paddingRight:
      sidebarWidth > 0 ? sidebarWidth + WEB_PANEL_MARGIN + WEB_PANEL_GAP : WEB_PANEL_MARGIN,
    paddingBottom: getWebBottomPanelHeight(screenHeight, safeBottom) + WEB_PANEL_MARGIN,
  };
}
