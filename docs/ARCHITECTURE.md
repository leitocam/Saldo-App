# Arquitectura de Saldo

## Capas

La página Next.js monta el controlador React y una interfaz de cinco secciones. `finance.ts` utiliza Decimal.js para proyecciones de saldo, reportes y FIFO; `commands.ts` valida comandos y produce un nuevo estado sin modificar el anterior. `storage.ts` conserva estado y pendientes en IndexedDB, con claves separadas para demostración, local y cada usuario autenticado.

En nube, las rutas autentican mediante Supabase SSR y verifican `OWNER_EMAIL`, si está configurado. La clave publicable respeta RLS. `read_finance_state` devuelve importes como texto: evita la pérdida de precisión al leer números JSON. La API no requiere `service_role`.

## Comandos y concurrencia

Cada creación recibe un UUID en el dispositivo. Las ediciones/anulaciones exigen `expected_version`. El RPC público es invoker y delega a una función en el esquema no expuesto `finance`. Esa función necesita privilegios de definición porque las tablas no conceden escritura al cliente; tiene `search_path` vacío, exige `auth.uid()`, verifica cada referencia y serializa por usuario con un advisory lock transaccional.

Las recepciones guardadas identifican el contenido completo del comando. Una retransmisión idéntica devuelve el resultado existente. Usar un UUID ajeno, una versión antigua o una referencia de otro usuario falla. El índice de `recurring_key` evita confirmar dos veces la misma fecha de un recurrente.

Las operaciones monetarias reconstruyen entradas por cuenta, lotes y consumos FIFO dentro de la transacción. Si una venta excede inventario, invalida una venta posterior o invade reservas, se revierte toda la operación. Los ajustes de saldo generan movimientos explícitos; no reescriben el saldo inicial de una cuenta existente.

La cola se guarda antes de intentar enviarla. Errores de red, 429 y 5xx conservan el pendiente para reintentar; 401 solicita volver a entrar; errores de validación conservan el contenido como rechazado. Una respuesta perdida puede reconciliarse con el estado remoto, incluso si las escalas decimales o la zona horaria del JSON se normalizaron. La persistencia local se serializa y una respuesta remota no se aplica si se cambió de espacio durante la petición.

## Modelo

`profiles`, `accounts`, `categories`, `movements`, `account_entries`, `usdt_lots`, `usdt_consumptions`, `goals`, `goal_allocations`, `budgets`, `recurring` y `quotes`. Todas las tablas públicas tienen `user_id`, políticas RLS de lectura y referencias validadas en el límite de escritura. Los índices cubren usuario/fecha, cuenta y cotización.

BOB se registra a dos decimales, USDT a ocho y costos derivados a doce. La aritmética del cliente usa precisión 40. Moneda y fecha local se presentan explícitamente; los instantes se guardan con zona horaria y los períodos se comparan en `America/La_Paz`.

## Reglas económicas

Una compra descuenta BOB + comisión BOB y crea un lote con USDT − comisión USDT. Su costo unitario es el BOB total dividido por USDT netos. Una venta consume USDT vendidos + comisión USDT, acredita BOB recibidos − comisión BOB y calcula beneficio con el costo FIFO de toda la cantidad consumida.

Las compras/ventas anteriores a la fecha de corte usan `history_only`: reconstruyen inventario sin repetir movimientos bancarios. Una apertura con costo desconocido conserva `null`, no cero. Las ventas que consumen costo desconocido no muestran un beneficio completo; el costo y resultado conocidos se identifican como parciales.

Reservar en una meta no cambia inventario ni patrimonio. La suma reservada nunca puede superar el saldo USDT. El patrimonio agrega BOB de bancos/efectivo y valoración del total de USDT una sola vez. Reportes de consumo incluyen solo ingresos y gastos; transferencias, ajustes y operaciones Binance mantienen tipos propios.

## Cotización

El servidor consulta métodos oficiales y anuncios de `USDT/BOB` con intención `SELL`. Filtra banco, disponibilidad, límites para el monto configurado y umbrales de calidad. Deduplica comerciantes, selecciona hasta cinco ofertas válidas y necesita tres para calcular mediana. No usa una oferta alta incompatible ni reemplaza silenciosamente la última referencia cuando falla el proveedor.

Los defaults son 100 USDT, 100 operaciones, 95 % de finalización y 98 % de valoración positiva. Consulta al abrir Binance y cada cinco minutos mientras está visible. Las muestras tienen fuente y hora; después de quince minutos se etiquetan antiguas. La referencia manual también tiene fecha y se muestra como manual.

## Límites operativos

No se ejecutan compras, ventas ni transferencias reales, no se conecta el banco y no se almacena una clave de Binance. Recurrentes requieren confirmación del pago. El modo local es almacenamiento del navegador, no un respaldo externo. La recarga offline necesita haber abierto la instalación antes con conexión.

La base se prueba con PGlite; la integración Supabase necesita además validar correo/contraseña, propietario, políticas y sincronización contra el proyecto remoto. Los logs técnicos deben contener fase y código de fallo, nunca notas, saldos, correos, contraseñas ni payloads de movimientos.
