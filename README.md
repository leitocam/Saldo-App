# Saldo

Finanzas personales en BOB y seguimiento de ahorro en USDT. Aplicación Next.js / TypeScript, móvil primero, instalable y con almacenamiento sin conexión.

[Abrir Saldo](https://saldo-finanzas-nine.vercel.app). Requiere acceso de Vercel; después crea tu acceso personal.

Código: [leitocam/Saldo-App](https://github.com/leitocam/Saldo-App). El proyecto Vercel `saldo-finanzas` está conectado directamente a este repositorio. Un `git push origin main` publica en la dirección estable anterior; las otras ramas generan vistas previas. Las variables de Supabase y `OWNER_EMAIL` están configuradas en Preview y Production, fuera del repositorio. Las migraciones de base de datos requieren su aplicación explícita; el despliegue de Next.js no las ejecuta.

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

## Conectar la nube

El proyecto dedicado provisionado es `saldo-finanzas` (`juwusslvhwycmudynqln`), en Leo_Personal. Las migraciones ya están aplicadas. La vista previa exige acceso de Vercel y la aplicación restringe el correo a su propietario mediante `OWNER_EMAIL`. Para empezar, usa **Crear mi acceso**, el correo acordado y una contraseña propia; confirma el correo y configura tus saldos. No se han cargado finanzas reales ni creado la contraseña del propietario.

1. Crea un proyecto Supabase **dedicado**. La organización y el costo deben elegirse antes de provisionarlo. No aplicar esta migración a una aplicación existente.
2. Aplica todas las migraciones de `supabase/migrations` al proyecto nuevo, en orden. Con la CLI autenticada: `npx supabase link --project-ref TU_PROJECT_REF`, seguido de `npx supabase db push`.
3. Copia `.env.example` a `.env.local`. Configura `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` con los valores del proyecto; son claves publicables. Nunca usar una clave privilegiada en una variable `NEXT_PUBLIC_*`.
4. Define `OWNER_EMAIL` con tu correo para restringir el acceso desde la aplicación. Mantén desactivada la inscripción pública en Supabase y crea/invita al propietario, o habilítala únicamente para registrar ese correo y desactívala después. El aislamiento por usuario también se verifica en Postgres.
5. Configura correo/contraseña, URL del sitio y confirmación de correo en Supabase Auth. La contraseña se introduce en la aplicación; no se guarda en archivos del proyecto.
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

Vercel detecta Next.js. Añade las tres variables anteriores a Preview y Production y crea primero una vista previa. Verifica protección de acceso y que ningún recurso privilegiado llegue al navegador. Antes de cargar datos reales, prueba dos usuarios, un movimiento desde cada dispositivo y la recuperación tras desconexión.

El modo local no se migra automáticamente a la nube. El asistente carga los saldos en el espacio seleccionado para evitar duplicaciones; exporta el historial local antes de cambiar si necesitas conservarlo fuera del dispositivo.

Las funciones de la vista previa se configuran en São Paulo mediante `vercel.json`, cerca de la base. [Referencia oficial de regiones de Vercel](https://vercel.com/docs/project-configuration/vercel-json#regions). `docs/deployment/supabase/config.toml` mantiene únicamente los ajustes de Auth declarados; no reemplaza otros valores del proveedor. Para actualizarlo: `npx supabase config diff --project-ref TU_PROJECT_REF --workdir docs/deployment` y después `config push` con los mismos argumentos.

Se pausó **custodia-hogar** por indicación del propietario para liberar el segundo cupo gratuito de Supabase. Conservar ese estado al revisar o desplegar Saldo; no reanudar ni eliminar proyectos ajenos automáticamente.

## Guías

- `DESIGN.md`: referencias, tokens, composiciones, estados y accesibilidad.
- `docs/ARCHITECTURE.md`: datos, cálculos, comandos, sincronización y operación.
