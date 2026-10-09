# Economía de los planes y cómo fijar los límites con datos

Este documento explica por qué cada plan tiene los límites que tiene y cómo comprobar, con números tuyos, que ninguno pierde dinero. **No contiene ningún coste inventado**: las cifras de coste real las mide el titular (ver "Cómo medir el coste por generación") y hasta entonces las celdas dicen *pendiente de medir*.

Las columnas de precio y de límites se copian de `@mockia/shared` (`PLAN_PRICE_USD`, `PLAN_LIMITS`) y un test (`packages/backend/src/tests/docs.economics.test.ts`) falla si esta tabla y el catálogo dejan de coincidir.

## Tabla de planes

| Plan | Precio mensual (USD) | Precio anual (USD) | Proyectos activos | Peticiones al mes | Generaciones de IA al mes | Coste de IA en el peor caso | Margen estimado |
|---|---|---|---|---|---|---|---|
| Free | 0 | 0 | 5 | 10.000 | 5 | pendiente de medir por el titular | pendiente de medir por el titular |
| Starter | 5 | 50 | 15 | 100.000 | 40 | pendiente de medir por el titular | pendiente de medir por el titular |
| Pro | 29 | 290 | 50 | 1.000.000 | 300 | pendiente de medir por el titular | pendiente de medir por el titular |
| Team | 99 | 990 | Ilimitados | 10.000.000 | 1.500 | pendiente de medir por el titular | pendiente de medir por el titular |

- Los precios son **sin IVA**. En la factura de un consumidor de España (u otro país con IVA) Stripe Tax añade el impuesto encima del precio. Si prefieres anunciar el precio con IVA incluido, es una decisión del titular y de su gestoría: cambia lo que ingresas por cada venta (el importe neto es menor) y los Price de Stripe pasarían a "Tax behavior = Inclusive".
- El pago anual cobra 10 meses (dos meses gratis). Cobra una sola vez al año, así que la comisión fija de Stripe se paga una vez en lugar de doce: el plan anual es **más** rentable por euro ingresado en comisiones, aunque entre menos dinero al mes.
- Free pierde dinero a propósito (es el coste de captación): su "margen" es el gasto máximo que asume el titular por cada usuario gratuito activo. Su cupo de IA es el más bajo para acotarlo.
- Las peticiones a los mocks y los proyectos cuestan casi nada comparados con la IA: el **único coste variable relevante es la generación con IA**, por eso es lo que cada plan limita de forma estricta (`maxMonthlyAiGenerations`, aplicado en el servidor antes de llamar al modelo).

## Fórmula del margen

```
margen = precio − comisión de Stripe − (generaciones × coste por generación) − hosting prorrateado
```

- **precio**: lo que ingresas en un mes con facturación mensual (en el anual, el precio anual dividido entre 12).
- **comisión de Stripe**: un porcentaje del importe más una cantidad fija por cobro. Los rangos habituales son del orden de 1,5 % + cuota fija para tarjetas europeas y 2,9 % + cuota fija para tarjetas de EE. UU. e internacionales, más un cargo por Stripe Tax y por conversión de divisa si aplica. **Son orientativos: verifica en tu país** las tarifas de tu cuenta (Stripe → Configuración → Facturación → Precios) antes de fiarte de ellas. En un plan de pocos dólares la cuota fija pesa mucho: es la razón de que Starter sea el plan más sensible a un error en esta fórmula.
- **generaciones**: lo que gasta el usuario ese mes, como máximo `maxMonthlyAiGenerations` de su plan.
- **coste por generación**: lo que cuesta una llamada al modelo (ver siguiente apartado).
- **hosting prorrateado**: el coste fijo mensual de servidor, base de datos y correo, dividido entre los clientes de pago. Baja a medida que crece el número de clientes: para decidir límites usa un valor prudente (pocos clientes).

## Cómo medir el coste por generación

1. Elige el modelo que usarás en producción (OpenRouter o local, ver `docs/ia-local.md`).
2. Ejecuta el banco de evaluación contra ese proveedor: `npm run eval -w @mockia/backend -- --provider=openrouter` (o `--provider=local`). Con él obtienes los **tokens de salida** por generación y la tasa de tokens por segundo (ver `packages/backend/evals/README.md`).
3. Los **tokens de entrada** son el tamaño del prompt (el banco comprueba que cada caso cabe en unos 6.000 tokens); para el total real, el panel de actividad de OpenRouter muestra tokens de entrada, de salida y coste de cada llamada.
4. Calcula: `coste por generación = tokens de entrada × precio por token de entrada + tokens de salida × precio por token de salida`, con los precios del modelo elegido (OpenRouter los publica por millón de tokens). Usa el **percentil alto** (el banco imprime p95), no la media: la regla de abajo tiene que aguantar el peor caso.
5. Con un modelo local no hay precio por token: el coste es el de la máquina (electricidad y amortización de la GPU, o el alquiler por hora) dividido entre las generaciones que hace al mes. Mídelo con el mismo banco y la duración de cada petición.

Apunta el resultado en una nota privada con la fecha, el modelo y el percentil usado. Si cambias de modelo, vuelve a medir.

## Regla para elegir `maxMonthlyAiGenerations`

El peor caso es el usuario que agota todo su cupo cada mes. La regla es que **incluso entonces el margen sea ≥ 0**, y se decide con el plan Starter porque es el más barato y el que tiene la cuota fija de Stripe más pesada:

```
sea p = precio mensual del plan
    f = porcentaje de comisión de Stripe (0 a 1)
    k = cuota fija de Stripe por cobro
    h = hosting prorrateado por cliente
    c = coste por generación (percentil alto)

margen del peor caso = p − (p × f + k) − (g × c) − h  ≥ 0

g máximo = suelo( (p × (1 − f) − k − h) / c )
```

`g` es el valor de `maxMonthlyAiGenerations` de ese plan. Si el `g` que sale es menor que el valor actual (40 en Starter), hay que bajarlo (o subir el precio) antes de vender el plan. Aplica la misma fórmula a Pro y Team con su precio: suelen tener más margen porque el precio crece más deprisa que el cupo, pero comprobarlo cuesta un minuto. En Free no hay precio: elige `g` de modo que `g × c` sea el gasto por usuario gratuito que estás dispuesto a asumir.

## Cómo reajustar un valor

Un cambio de precio o de límite toca **dos sitios que deben quedar alineados**:

1. La constante en `packages/shared/src/billing.ts`: `PLAN_LIMITS[plan].maxMonthlyAiGenerations` (o los otros límites) y, para el precio, `PLAN_PRICE_USD`. Reconstruye `@mockia/shared` (`npm run build -w @mockia/shared`). El servidor y la web leen de aquí; este documento y su test fallan hasta que actualices la tabla de arriba.
2. En Stripe: un precio nuevo se crea como un **Price de Stripe nuevo** (un Price existente no cambia de importe) y su identificador va en la variable de entorno del plan (`STRIPE_PRICE_STARTER_MONTHLY`, `STRIPE_PRICE_STARTER_YEARLY`, etc.; ver `docs/pagos.md`). Los suscriptores actuales mantienen el precio con el que contrataron hasta que los migres tú desde Stripe.

Un límite más bajo no borra nada a quien ya tenía proyectos: solo impide crear más y rechaza las generaciones cuando se agota el cupo del mes. Avisa a los clientes de pago antes de recortar un cupo que ya se anunció (los Términos remiten a la sección de precios de la web).
