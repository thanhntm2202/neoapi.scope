declare module 'plotly.js-dist-min' {
  const Plotly: {
    react: (root: HTMLElement, data: any[], layout?: any, config?: any) => Promise<any>;
    purge: (root: HTMLElement) => void;
    Plots: {
      resize: (root: HTMLElement) => void;
    };
  };
  export default Plotly;
}
