# Saldo

Finanzas personales en BOB y seguimiento de ahorro en USDT. Aplicación Next.js / TypeScript, móvil primero, instalable y con almacenamiento sin conexión.

[Abrir Saldo](https://saldo-finanzas-nine.vercel.app). El enlace es público y no requiere una cuenta de Vercel. Los datos financieros requieren iniciar sesión en Saldo; también puedes explorar la demostración.

Código: [leitocam/Saldo-App](https://github.com/leitocam/Saldo-App). El proyecto Vercel `saldo-finanzas` está conectado directamente a este repositorio. Un `git push origin main` publica en la dirección estable anterior; las otras ramas generan vistas previas. Las variables de Supabase están configuradas en Preview y Production, fuera del repositorio. Las migraciones de base de datos requieren su aplicación explícita; el despliegue de Next.js no las ejecuta.

La barra superior permite **Salir de la demo** para volver al login. En la cuenta privada muestra **Cerrar sesión**, que cierra la sesión de este dispositivo y limpia su copia local privada cuando no quedan registros pendientes. Los datos confirmados permanecen en Supabase.

## Ejecutar

Se recomienda Node.js 24 LTS. Instala dependencias con `npm ci` y ejecuta `npm run dev`. Abre `http://localhost:3000`.

Sin variables de Supabase se abre una **demostración**, separada del espacio local. “Configurar mis cuentas” crea tu espacio con saldos actuales y, opcionalmente, historial USDT. Los cambios locales viven en IndexedDB de ese navegador. Cambiar de dispositivo o borrar los datos del navegador no conserva ese espacio; la sincronización entre dispositivos requiere conectar Supabase.

Para comprobar el funcionamiento sin conexión usa la compilación de producción:

```sh
npm run build
npm run start
```

Abre una vez con internet para instalar el service worker y almacenar los recursos. El soporte de instalación depende del navegador y necesita HTTPS fuera de localhost.

## Funcionalidad

- Gastos, ingresos, transferencias, compras/ventas USDT y ajustes trazables.
- Cuentas, categorías favoritas editables, filtros y exportación CSV.
- FIFO, comisiones en BOB/USDT, costos desconocidos y correcciones históricas.
- Metas con reservas de USDT; presupuestos mensuales y confirmación de recurrentes.
- Reportes por período/cuenta/categoría; ingresos personales separados de movimientos de fondos.
- Consulta de venta Binance P2P filtrada por bancos, monto y calidad; referencia manual identificada.
- Cola por usuario con reintentos idempotentes y conservación de registros rechazados.
- Disponible del mes y referencia diaria después de recurrentes pendientes y deudas por pagar con vencimiento este mes.
- Deudas por cobrar/pagar, abonos parciales y ajustes bancarios atómicos en **Cuentas**.
- Grupos compartidos en la nube: invitaciones de un uso, reparto igual o personalizado y pagos confirmados por quien recibe. Cada persona mantiene sus cuentas privadas.
- Conciliación USDT/USDC, cargos pendientes de tarjeta, devoluciones y cashback en **Binance → Control de Binance**. El precio de USDC se introduce manualmente y se distingue de USDT.
- Respaldo JSON, restauración con vista previa y sin sobrescribir, e importación CSV con mapeo y detección de duplicados en **Ajustes → Datos**.

## Conectar la nube

El proyecto dedicado provisionado es `saldo-finanzas` (`juwusslvhwycmudynqln`), en Leo_Personal. Las migraciones ya están aplicadas. Cualquier persona puede crear una cuenta con su correo y contraseña mediante **Crear mi acceso**. Por decisión del propietario, el registro entra directamente sin confirmación por correo. Cada cuenta empieza con su propio espacio vacío; no comparte cuentas bancarias ni movimientos con otros usuarios. Los distintos correos de una misma persona también crean espacios separados.

1. Crea un proyecto Supabase **dedicado**. La organización y el costo deben elegirse antes de provisionarlo. No aplicar esta migración a una aplicación existente.
2. Aplica todas las migraciones de `supabase/migrations` al proyecto nuevo, en orden. Con la CLI autenticada: `npx supabase link --project-ref TU_PROJECT_REF`, seguido de `npx supabase db push`.
3. Copia `.env.example` a `.env.local`. Configura `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` con los valores del proyecto; son claves publicables. Nunca usar una clave privilegiada en una variable `NEXT_PUBLIC_*`.
4. Habilita el registro mediante correo/contraseña en Supabase. El aislamiento por usuario se verifica en Postgres; no hay una lista de correos permitidos en la aplicación.
5. Configura la URL del sitio y sus redirecciones en Supabase Auth. La configuración desplegada tiene `enable_confirmations = false`: el correo identifica la cuenta, pero no se verifica su propiedad. La contraseña se introduce en la aplicación; no se guarda en archivos del proyecto. Para habilitar confirmaciones o recuperación por correo, configura primero un proveedor SMTP propio.
6. Reinicia la aplicación. En Ajustes → Mi espacio puedes pasar de demostración a nube. La configuración inicial empieza en blanco; los datos de ejemplo no se suben.

La migración habilita RLS en todas las tablas, permite lectura propia y bloquea escrituras directas del cliente. Los comandos financieros se ejecutan bajo un bloqueo por usuario y se confirman en una sola transacción. Los valores monetarios salen del RPC como cadenas decimales.

## Validación

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Las pruebas de base usan Postgres real compilado a WASM con PGlite. Preparan un contexto de autenticación equivalente para comprobar funciones, permisos y rollback; no sustituyen la prueba final de login y RLS en el proyecto Supabase desplegado. Playwright prueba escritorio y celular sobre el servidor de producción, incluidos almacenamiento, edición, configuración inicial, exportación y recarga sin internet.

## Despliegue

Vercel detecta Next.js. Añade las dos variables de Supabase a Preview y Production y crea primero una vista previa. Verifica protección de datos y que ningún recurso privilegiado llegue al navegador. Antes de cargar datos reales, prueba dos usuarios, un movimiento desde cada dispositivo y la recuperación tras desconexión.

El modo local no se migra automáticamente a la nube. Puedes descargar su respaldo JSON, cambiar a tu cuenta y restaurarlo desde Ajustes → Datos. La vista previa identifica registros nuevos, copias y conflictos; no sobrescribe datos existentes ni mezcla fechas de inicio diferentes. Los grupos compartidos se exportan por separado como CSV y no se restauran desde el archivo personal.

## Recuperación de contraseña preparada

El propietario decidió dejar preparado el flujo mientras elige proveedor SMTP. `PASSWORD_RECOVERY_ENABLED` permanece desactivado; el formulario explica que todavía no enviará correos. No se usan correos de confirmación para el registro directo.

Para habilitar la recuperación: configura SMTP propio y el remitente en Supabase Auth; autoriza la redirección `https://saldo-finanzas-nine.vercel.app/auth/callback?next=/recover`; añade `PASSWORD_RECOVERY_ENABLED=true` solo en el servidor de Vercel y vuelve a desplegar. Prueba primero con una cuenta de prueba. El enlace intercambia un código PKCE y permite cambiar la contraseña de la sesión autenticada; después revoca las sesiones de actualización y vuelve al login. Los tokens de acceso ya emitidos conservan su vigencia hasta expirar.

Los respaldos JSON contienen información financiera privada. El límite de restauración es 3 MB y el CSV admite hasta 500 filas por archivo. Si hay operaciones pendientes, el respaldo las conserva como archivo informativo; no las reenvía automáticamente. Sincroniza y descarga un respaldo confirmado antes de restaurar.

Las funciones de la vista previa se configuran en São Paulo mediante `vercel.json`, cerca de la base. [Referencia oficial de regiones de Vercel](https://vercel.com/docs/project-configuration/vercel-json#regions). `docs/deployment/supabase/config.toml` mantiene únicamente los ajustes de Auth declarados; no reemplaza otros valores del proveedor. Para actualizarlo: `npx supabase config diff --project-ref TU_PROJECT_REF --workdir docs/deployment` y después `config push` con los mismos argumentos.

Se pausó **custodia-hogar** por indicación del propietario para liberar el segundo cupo gratuito de Supabase. Conservar ese estado al revisar o desplegar Saldo; no reanudar ni eliminar proyectos ajenos automáticamente.

## Guías

- `DESIGN.md`: referencias, tokens, composiciones, estados y accesibilidad.
- `docs/ARCHITECTURE.md`: datos, cálculos, comandos, sincronización y operación.
