// =============================================================================
// BRAND CONFIGURATION — Central single source of truth for all branding
// =============================================================================
const BRAND = {
  APP_NAME: "Work Management",
  BRAND_LINE_1: "EDC",
  BRAND_LINE_2: "WORK MANAGEMENT",
  DEPARTMENT_NAME: "EDC Department",
  LOGO_PATH: "favicon-512.png",
  COLORS: {
    PRIMARY: "#7C3AED",
    PRIMARY_GRADIENT_START: "#7C3AED",
    PRIMARY_GRADIENT_END: "#5B21B6",
    ACCENT: "#A855F7",
    DARK_BG: "#0b1121",
    SIDEBAR_BG: "#0B1220",
    TOPBAR_BG: "#0A0E16"
  }
};

// Apply brand dynamically to document title and branding DOM elements
function applyBrand() {
  // Page Title
  if (document.title) {
    document.title = `${BRAND.APP_NAME} — Task Tracker`;
  }

  // Sidebar Brand
  const sbBrandLine1 = document.querySelector('.sidebar-brand .brand');
  if (sbBrandLine1) sbBrandLine1.textContent = BRAND.BRAND_LINE_1;
  const sbBrandLine2 = document.querySelector('.sidebar-brand .brand-sub');
  if (sbBrandLine2) sbBrandLine2.textContent = BRAND.BRAND_LINE_2;

  // Login Card Brand
  const loginBrand = document.querySelector('.auth-card-brand .brand');
  if (loginBrand) loginBrand.textContent = `${BRAND.BRAND_LINE_1} / ${BRAND.BRAND_LINE_2}`;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBrand);
  } else {
    applyBrand();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BRAND;
}
