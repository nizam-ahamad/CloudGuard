/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      "colors": {
              "tertiary": "#000000",
              "on-secondary-fixed": "#001a42",
              "on-tertiary-fixed": "#002113",
              "primary-fixed": "#dae2fd",
              "primary": "#000000",
              "tertiary-fixed-dim": "#4edea3",
              "surface-container": "#e5eeff",
              "on-tertiary-fixed-variant": "#005236",
              "outline": "#76777d",
              "on-primary": "#ffffff",
              "on-surface": "#0b1c30",
              "surface": "#f8f9ff",
              "tertiary-fixed": "#6ffbbe",
              "on-error": "#ffffff",
              "surface-container-high": "#dce9ff",
              "background": "#f8f9ff",
              "surface-container-low": "#eff4ff",
              "surface-container-lowest": "#ffffff",
              "on-tertiary": "#ffffff",
              "on-background": "#0b1c30",
              "on-primary-container": "#7c839b",
              "error": "#ba1a1a",
              "surface-tint": "#565e74",
              "secondary": "#0058be",
              "inverse-primary": "#bec6e0",
              "inverse-on-surface": "#eaf1ff",
              "surface-bright": "#f8f9ff",
              "inverse-surface": "#213145",
              "secondary-container": "#2170e4",
              "on-secondary-fixed-variant": "#004395",
              "error-container": "#ffdad6",
              "secondary-fixed": "#d8e2ff",
              "surface-dim": "#cbdbf5",
              "outline-variant": "#c6c6cd",
              "on-secondary": "#ffffff",
              "on-primary-fixed": "#131b2e",
              "on-surface-variant": "#45464d",
              "tertiary-container": "#002113",
              "on-tertiary-container": "#009668",
              "primary-fixed-dim": "#bec6e0",
              "on-secondary-container": "#fefcff",
              "surface-container-highest": "#d3e4fe",
              "surface-variant": "#d3e4fe",
              "primary-container": "#131b2e",
              "on-primary-fixed-variant": "#3f465c",
              "on-error-container": "#93000a",
              "secondary-fixed-dim": "#adc6ff"
      },
      "borderRadius": {
              "DEFAULT": "0.25rem",
              "lg": "0.5rem",
              "xl": "0.75rem",
              "full": "9999px"
      },
      "spacing": {
              "stack-md": "16px",
              "margin-desktop": "40px",
              "margin-mobile": "16px",
              "stack-sm": "8px",
              "unit": "8px",
              "container-max": "1440px",
              "stack-lg": "32px",
              "gutter": "24px"
      },
      "fontFamily": {
              "code-sm": [
                      "Inter"
              ],
              "body-md": [
                      "Inter"
              ],
              "label-md": [
                      "Inter"
              ],
              "body-lg": [
                      "Inter"
              ],
              "title-lg": [
                      "Inter"
              ],
              "headline-lg": [
                      "Inter"
              ],
              "headline-lg-mobile": [
                      "Inter"
              ],
              "headline-md": [
                      "Inter"
              ],
              "display-lg": [
                      "Inter"
              ]
      },
      "fontSize": {
              "code-sm": [
                      "13px",
                      {
                              "lineHeight": "18px",
                              "fontWeight": "400"
                      }
              ],
              "body-md": [
                      "14px",
                      {
                              "lineHeight": "20px",
                              "fontWeight": "400"
                      }
              ],
              "label-md": [
                      "12px",
                      {
                              "lineHeight": "16px",
                              "letterSpacing": "0.05em",
                              "fontWeight": "600"
                      }
              ],
              "body-lg": [
                      "16px",
                      {
                              "lineHeight": "24px",
                              "fontWeight": "400"
                      }
              ],
              "title-lg": [
                      "20px",
                      {
                              "lineHeight": "28px",
                              "fontWeight": "500"
                      }
              ],
              "headline-lg": [
                      "32px",
                      {
                              "lineHeight": "40px",
                              "letterSpacing": "-0.01em",
                              "fontWeight": "600"
                      }
              ],
              "headline-lg-mobile": [
                      "24px",
                      {
                              "lineHeight": "32px",
                              "fontWeight": "600"
                      }
              ],
              "headline-md": [
                      "24px",
                      {
                              "lineHeight": "32px",
                              "fontWeight": "600"
                      }
              ],
              "display-lg": [
                      "48px",
                      {
                              "lineHeight": "56px",
                              "letterSpacing": "-0.02em",
                              "fontWeight": "700"
                      }
              ]
      }
    },
  },
  plugins: [],
}
