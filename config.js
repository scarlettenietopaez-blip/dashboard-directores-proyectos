// Configuración del dashboard para GitHub Pages.
//
// Fuente de datos actual:
// El dashboard lee directamente el archivo CSV cargado en GitHub:
// data/projects.csv
//
// Para actualizar la información, descarga la matriz como CSV UTF-8,
// renómbrala projects.csv y reemplaza el archivo dentro de la carpeta data.
window.DASHBOARD_CONFIG = {
  dataUrl: "data/projects.csv",
  autoRefreshMinutes: 5,
  cacheBust: true
};
