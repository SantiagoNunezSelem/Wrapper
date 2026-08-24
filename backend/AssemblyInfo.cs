using System.Runtime.CompilerServices;

// El proyecto de tests necesita ver dos cosas que este assembly declara como internas:
//
//  - la clase `Program` que el compilador genera para los top-level statements, que es
//    el tipo con el que `WebApplicationFactory<Program>` levanta la API en memoria;
//  - los tipos de apoyo (`SavedAnalysisLimits` y los records de request/response), para
//    que un test afirme sobre la constante real en vez de repetir el número a mano y
//    quedar desactualizado en silencio cuando alguien la cambie.
//
// Es la alternativa menos invasiva a volver `Program` público: no agranda la superficie
// pública del assembly, sólo se la abre a un consumidor con nombre y apellido.
[assembly: InternalsVisibleTo("backend.Tests")]
