# CyberConcept

Página para practicar los acrónimos de ciberseguridad. Muestra las siglas y pide su significado, o al revés, con un banco de más de 300 términos organizados por categoría y tema.

## Modos

- Escribir: ves las siglas y escribes el significado completo. Se acepta cualquier escritura razonable: sin acentos, sin guiones, sin importar mayúsculas y con pequeñas erratas.
- Opción múltiple: ves las siglas y eliges entre cuatro significados. Los distractores salen de la misma categoría.
- Inverso: ves el significado y la descripción, y escribes las siglas.
- Mixto: las tres dinámicas mezcladas.

## Funciones

- Filtro por categorías y por temas dentro de cada categoría.
- Número de preguntas y tiempo opcional por pregunta.
- Pistas progresivas en los modos de escritura.
- Prioridad para los acrónimos fallados o nunca vistos.
- Resumen al final de cada sesión con repaso de los fallos.
- Glosario con búsqueda y vista de progreso por categoría.
- Tema claro y oscuro. Atajos: Enter para comprobar y avanzar, 1 a 4 para elegir opción, Alt+H para pista.

El progreso se guarda en el almacenamiento local del navegador; no hay servidor ni cuentas.

## Uso

Es un sitio estático sin dependencias. Basta con servir la carpeta con cualquier servidor de archivos, por ejemplo:

```
python -m http.server 8765
```

y abrir `http://localhost:8765`.

## Estructura

- `index.html`: estructura de la página e íconos SVG.
- `css/styles.css`: estilos, tema claro y oscuro, diseño responsivo.
- `js/data.js`: categorías y banco de acrónimos.
- `js/app.js`: lógica de práctica, glosario y progreso.

Para agregar un acrónimo, añade una entrada en `js/data.js` con sus siglas (`a`), significado (`e`), descripción (`d`), categoría (`c`), tema (`t`) y, si aplica, otras respuestas aceptadas (`alt`).
