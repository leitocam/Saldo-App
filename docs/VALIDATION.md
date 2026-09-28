# Revisión de la primera versión

Fecha: 28 de septiembre de 2026. Zona: America/La_Paz.

- Compilación de producción y TypeScript: correctos.
- Vitest: 29 pruebas aprobadas de aritmética exacta, FIFO, comisiones, reservas, historia inicial, permisos, transacciones, versiones, recurrencias, exportación y recuperación de respuestas perdidas.
- Playwright: 16 recorridos aprobados en escritorio y celular, sobre la compilación de producción. Incluyen las cinco pantallas, ausencia de desborde, registro con coma, persistencia, corrección/anulación, asistente, filtros, CSV, metas y recarga sin internet y conservación de filtros al abrir movimientos desde reportes.
- Axe: sin infracciones WCAG A/AA detectadas en Inicio y registro rápido, en ambas resoluciones probadas. No es una certificación de todas las pantallas.
- Supabase dedicado: 12 tablas públicas con RLS. La revisión de seguridad no informó avisos.
- Verificación en Postgres remoto bajo `authenticated`: FIFO de Bs 320, transferencia idempotente con dos entradas y aislamiento entre dos usuarios aprobados. Toda la prueba se revirtió; quedaron cero usuarios y movimientos de prueba.
- API desplegada: una lectura de datos sin sesión devuelve 401. Vercel exige autenticación para acceder a la vista previa.
- Dependencias: auditoría sin vulnerabilidades conocidas en la instalación verificada.

La contraseña del propietario no fue creada por el agente. La confirmación de correo y el recorrido entre dos dispositivos con la cuenta personal se verifican cuando el propietario crea su acceso. No se han cargado datos financieros reales.

Los datos de demostración y del dispositivo están separados de la nube. La cola se prueba con respuestas de red simuladas y Postgres; una sesión real permite completar la comprobación del ciclo sin conexión frente al proveedor.

Las cotizaciones dependen de Binance. Un fallo conserva la última referencia, muestra su fecha y permite una entrada manual; no sustituye el valor por cero. El gráfico solo une muestras guardadas separadas por un máximo de 15 minutos.

## Comprobación en vivo de Binance

El 28 de septiembre de 2026 a las 15:27 de Bolivia se ejecutó `fetchQuote` del código de la aplicación contra Binance, sin simular la respuesta. USDT/BOB, perspectiva SELL, cantidad 100 USDT y umbrales predeterminados: estado `available`, cinco comerciantes distintos y mediana Bs 11,95 tanto sin filtro bancario como con BancoDeBolivia (BNB). Es una muestra puntual, no un precio garantizado. El registro personal de compras y ventas sigue siendo manual; no hay conexión con el saldo ni el historial privado de Binance.

La consulta en vivo anterior salió de este equipo. La API de métodos de pago también se comprobó en Vercel. La cotización desde Vercel con los filtros del propietario y su almacenamiento en Supabase requieren una sesión personal; ese recorrido no se sustituye por la prueba local.
