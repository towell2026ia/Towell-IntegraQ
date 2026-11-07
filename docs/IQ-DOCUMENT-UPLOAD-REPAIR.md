# Reparación de carga documental y RLS

Base `main`. No ramas, PR ni pruebas productivas. La propuesta específica requiere autorización antes de aplicarse. Se conserva íntegra `20261106020459`; no se ejecutan guardas generales pendientes.

La carga publicada sube el binario y hace `INSERT file_objects RETURNING id`. La política restrictiva `iq_document_replacement_file_read` llama al helper STABLE `iq_can_read_document_file`, que consulta la fila todavía sin versión. Las pruebas anteriores precargaban archivos como dueño del fixture y no ejercitaban ese INSERT autenticado. La nueva prueba debe reproducir el error antes de aplicar la propuesta.

La reparación reserva primero una referencia con identidad, proceso, organización, huella y estado de carga en campos existentes de `file_objects`. El binario se carga después en una ruta privada nueva, sin sobrescribir. La misma intención devuelve la misma reserva; un reintento no crea otra identidad. El registro final vincula expediente y versión pendiente en una transacción y conserva el recibo idempotente. Una interrupción conserva una carga pendiente identificada; no se borran originales como compensación ni se deja un binario sin referencia.

Permisos: administrador activo de la organización, o usuario interno activo con Documentos → Modificar y rol documental modificador en su proceso. Autorizar exige rol autorizador en el mismo proceso. Retiro y recuperación permanecen administrativos. No se modifican asignaciones.

La lectura verifica organización, proceso y estado, incluidos documentos legacy, pendientes propios e historial autorizado. Las escrituras directas no podrán modificar ni borrar archivos documentales históricos. Los recursos ajenos conservan sus políticas.

Código y nombre permanecen independientes. No se corrigen códigos históricos automáticamente; las altas nuevas no aceptan títulos concatenados al identificador.

PENDING: reproducción PostgreSQL, operaciones autenticadas con RLS en base efímera, concurrencia/idempotencia/fallos, typecheck/lint/build/CI y sesión real representativa. No se declara aceptación por pruebas unitarias.
