using System.Net;
using System.Text;

namespace backend.Tests.Infrastructure;

/// <summary>
/// Reemplaza la red en los clientes HTTP (Gemini, Mercado Pago, reCAPTCHA).
///
/// Guarda cada request con su cuerpo ya leído — el <see cref="HttpContent"/> original se
/// descarta apenas termina la llamada, así que un test que quisiera inspeccionarlo
/// después encontraría un stream cerrado.
/// </summary>
public sealed class StubHttpMessageHandler : HttpMessageHandler
{
    private readonly Queue<Func<HttpRequestMessage, HttpResponseMessage>> _queued = new();
    private Func<HttpRequestMessage, HttpResponseMessage>? _fallback;

    public List<CapturedRequest> Requests { get; } = [];

    public CapturedRequest LastRequest => Requests.Count > 0
        ? Requests[^1]
        : throw new InvalidOperationException("No se registró ninguna request.");

    /// <summary>Encola una respuesta para la próxima llamada.</summary>
    public StubHttpMessageHandler Enqueue(HttpStatusCode status, string body, string contentType = "application/json")
    {
        _queued.Enqueue(_ => new HttpResponseMessage(status)
        {
            Content = new StringContent(body, Encoding.UTF8, contentType),
        });
        return this;
    }

    /// <summary>Encola un fallo de transporte (DNS caído, conexión rechazada).</summary>
    public StubHttpMessageHandler EnqueueTransportFailure(string message = "connection refused")
    {
        _queued.Enqueue(_ => throw new HttpRequestException(message));
        return this;
    }

    /// <summary>Encola una llamada que nunca contesta, para probar el timeout del cliente.</summary>
    public StubHttpMessageHandler EnqueueTimeout()
    {
        _queued.Enqueue(_ => throw new TaskCanceledException("timed out"));
        return this;
    }

    /// <summary>Respuesta para cualquier llamada que no tenga una encolada.</summary>
    public StubHttpMessageHandler Always(HttpStatusCode status, string body)
    {
        _fallback = _ => new HttpResponseMessage(status)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        return this;
    }

    /// <summary>Respuesta elegida según la URL, para clientes que hacen varias llamadas distintas.</summary>
    public StubHttpMessageHandler Route(Func<HttpRequestMessage, HttpResponseMessage> responder)
    {
        _fallback = responder;
        return this;
    }

    public HttpClient CreateClient() => new(this) { BaseAddress = new Uri("https://stub.test") };

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);

        Requests.Add(new CapturedRequest(
            request.Method,
            request.RequestUri!,
            request.Headers.ToDictionary(header => header.Key, header => string.Join(",", header.Value), StringComparer.OrdinalIgnoreCase),
            body));

        var responder = _queued.Count > 0 ? _queued.Dequeue() : _fallback;

        if (responder is null)
        {
            throw new InvalidOperationException($"Llamada HTTP inesperada a {request.RequestUri}.");
        }

        return responder(request);
    }
}

public sealed record CapturedRequest(
    HttpMethod Method,
    Uri Uri,
    IReadOnlyDictionary<string, string> Headers,
    string? Body);
