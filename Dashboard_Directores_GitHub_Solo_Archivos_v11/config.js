// Configuración del dashboard para GitHub Pages.
//
// OPCIÓN ÚNICA DE ACTUALIZACIÓN:
// Power Automate lee la matriz Excel Online / SharePoint y actualiza
// el archivo data/projects.json dentro de este repositorio de GitHub.
//
// Este dashboard NO lee el enlace directo de SharePoint y NO usa CSV público.
window.DASHBOARD_CONFIG = {
  dataUrl: "data/projects.json",
  autoRefreshMinutes: 5,
  cacheBust: true
};
