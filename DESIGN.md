# Saldo · guía de diseño

Saldo es un espacio personal para entender dinero en bolivianos y ahorro en USDT. La interfaz debe sentirse tranquila, precisa y fácil de usar en un celular. El resultado principal de cada pantalla debe entenderse antes de explorar el detalle.

## Referencias y dirección

Las referencias originales están en `docs/references/controls.png` y `docs/references/selection.png`.

- **Controles:** superficies negras, cuadrículas de iconos simples, agrupación mediante espacio y separadores. Se aplica a accesos rápidos y categorías favoritas.
- **Selección:** títulos grandes, listas amplias, selección circular y acciones blancas redondeadas. Se aplica a categorías, cuentas, formularios y configuración inicial.
- Mantener el carácter oscuro, mejorar la legibilidad respecto a los grises de las referencias y reservar el color para comunicar significado. No copiar personas, controles de vehículos ni textos de las imágenes.

## Identidad y tokens

La marca es **saldo.** El punto verde expresa continuidad. El símbolo reúne dos trazos abiertos; debe usarse en iconos de instalación y encabezados, con espacio a su alrededor.

| Token           | Valor                 | Uso                                              |
| --------------- | --------------------- | ------------------------------------------------ |
| Fondo           | `#0B0B0C`             | Lienzo principal                                 |
| Superficie      | `#171719`             | Formularios y tarjetas                           |
| Elevada         | `#232528`             | Selección y controles                            |
| Texto           | `#F5F5F5`             | Cifras, títulos y acciones                       |
| Secundario      | `#B5B7BC`             | Explicaciones y etiquetas                        |
| Separador       | `#34363B`             | Límites discretos                                |
| Positivo        | `#83D6AF`             | Ingresos y resultados positivos                  |
| Negativo        | `#F29B9B`             | Pérdida, error y acciones destructivas           |
| Pendiente       | `#E6C478`             | Sincronización y presupuestos cercanos al límite |
| Botón principal | Blanco / texto oscuro | Registrar, guardar y continuar                   |

Las categorías pueden tener acentos suaves: menta, durazno, lavanda, azul y arena. Esos colores siempre acompañan un nombre y un icono.

### Tipografía y proporciones

Inter se sirve localmente; no depender de una petición a Google Fonts. Los importes usan cifras tabulares y formato `es-BO`, con moneda visible. BOB tiene dos decimales de presentación; USDT puede mostrar hasta ocho.

- Cuerpo y campos: 16 px; textos breves de interfaz pueden usar 13–14 px.
- Títulos de pantalla: 24–32 px. Titulares patrimoniales: 32–48 px.
- Etiquetas: 12–13 px. Metadatos: 11–12 px; microetiquetas decorativas pueden ser menores.
- Espaciado: 4, 8, 12, 16, 24 y 32 px. Márgenes móviles: 16–24 px.
- Tarjetas principales: radio 20–24 px. Panel inferior: 28 px arriba. Acción final de formulario: cápsula de 52 px.
- Evitar mayúsculas en frases largas; usarlas únicamente en etiquetas cortas y discretas.

## Composiciones

### Inicio

Encabezado personal y selector de mes. Tarjeta de patrimonio con un degradado grafito/verde y órbitas geométricas de bajo contraste. La cifra es protagonista; debajo se separan bancos/efectivo y Binance estimado. El resumen del mes ocupa una tarjeta secundaria. Siguen accesos rápidos, cuentas, movimientos, categorías, presupuestos y próximos pagos.

En escritorio, patrimonio y resumen forman dos columnas. Movimientos y distribución de gastos comparten otra fila. En móvil, el orden es vertical y las cuentas pueden recorrerse horizontalmente dentro de su propio carrusel.

La barra superior conserva una salida visible en todas las secciones: «Salir de la demo» en demostración y «Cerrar sesión» en la cuenta privada. El botón combina icono y texto y mide al menos 44 px de alto. En celular, el indicador de conexión se compacta a un icono con nombre accesible para que la salida quepa desde 360 px.

### Registrar un gasto

Panel inferior en móvil y diálogo centrado en escritorio. Primero se ve el tipo y el importe; después, categorías en tres columnas, cuenta y fecha, descripción y comisiones opcionales. La categoría elegida lleva contorno y marca circular. Guardar permanece como la acción más visible. Los errores aparecen junto al formulario sin eliminar lo escrito.

### Cuentas

Una tarjeta por cuenta: identificador visual, nombre, saldo, moneda y acciones Movimientos / Conciliar. El banco se distingue por texto; un color parecido no sustituye su nombre. Las cuentas archivadas se presentan en un grupo secundario.

### Binance

Saldo en USDT como cifra principal y equivalencia en BOB como estimación. Disponible y reservado permanecen juntos para entender el total. La referencia muestra fuente, fecha y estado. Los resultados distinguen costo, ganancia estimada y ganancia realizada. Las pestañas Ingresos / Egresos / Ahorro separan compras, ventas y metas. Los lotes se convierten en filas compactas en móvil.

### Reportes

Período y cuenta siempre visibles. Tres resultados: ingresos, gastos y diferencia. Gráfico mensual con dos series; dona de categorías con leyenda seleccionable; gastos por cuenta, movimientos de fondos, presupuestos y metas. No usar decoraciones que parezcan datos. Las cotizaciones históricas muestran exclusivamente muestras guardadas y dejan huecos cuando no hay información.

## Accesibilidad y estados

- Interacciones principales de al menos 44 × 44 px en móvil. Nunca depender de hover.
- Contraste AA para texto. Un gris tenue no puede ocultar etiquetas necesarias.
- Navegación con teclado, foco visible, nombres accesibles y diálogo con foco contenido.
- Gráficos con nombres, cifras y leyendas; positivo/negativo incluye texto o signo.
- Animaciones de 150–220 ms; respetar `prefers-reduced-motion`.
- Separar **guardado local**, **pendiente**, **rechazado** y **sincronizado**. No afirmar que se guardó en nube cuando solo está en el dispositivo.
- Cotización antigua: conservar fecha y etiquetar la última valoración. Sin precio: mostrar “Sin referencia”. Costo desconocido: “Costo incompleto”.
- Vacíos con explicación y siguiente acción concreta. Carga sin cifras inventadas. Errores con datos conservados y posibilidad de corregir.

## Revisión antes de entregar

Revisar Inicio, formulario de gasto, Cuentas, Binance y Reportes a 360, 390, 768 y 1440 px. No admitir desplazamiento horizontal de la página, importes cortados, botones cubiertos por el teclado o la navegación, etiquetas de moneda ausentes ni pérdida de datos al cerrar un error. Las capturas verificadas se guardan en `artifacts/` como evidencia local.
