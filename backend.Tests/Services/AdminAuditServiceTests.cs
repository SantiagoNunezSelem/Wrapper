using backend.Models;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Services;

/// <summary>Notas internas y el rastro de quién hizo qué desde el panel.</summary>
public class AdminAuditServiceTests : IDisposable
{
    private readonly TestDb _db = TestDb.Create();

    public void Dispose() => _db.Dispose();

    private AdminAuditService Service() => new(_db.Context);

    private User AddUser()
    {
        var user = new User { Email = $"{Guid.NewGuid():N}@example.com", DisplayName = "Cuenta" };
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();
        return user;
    }

    [Fact]
    public async Task Una_nota_queda_guardada_y_deja_rastro()
    {
        var user = AddUser();
        var adminId = Guid.NewGuid();

        var note = await Service().AddNoteAsync(user.Id, adminId, "admin@example.com", "  Pidió factura.  ", default);

        Assert.NotNull(note);
        Assert.Equal("Pidió factura.", note.Text);
        var trail = await _db.NewContext().AdminAuditEvents.SingleAsync();
        Assert.Equal(AdminActions.NoteAdded, trail.Action);
        Assert.Equal(user.Id, trail.TargetUserId);
        Assert.Equal(adminId, trail.AdminId);
    }

    [Fact]
    public async Task Una_nota_para_una_cuenta_que_no_existe_no_se_guarda()
    {
        var note = await Service().AddNoteAsync(Guid.NewGuid(), Guid.NewGuid(), "admin@example.com", "hola", default);

        Assert.Null(note);
        Assert.Empty(await _db.NewContext().AdminNotes.ToListAsync());
    }

    [Fact]
    public async Task Una_nota_larga_se_recorta_al_maximo()
    {
        var user = AddUser();

        var note = await Service().AddNoteAsync(user.Id, Guid.NewGuid(), "admin@example.com", new string('x', 5000), default);

        Assert.Equal(AdminAuditService.MaxNoteLength, note!.Text.Length);
    }

    [Fact]
    public async Task El_rastro_se_lee_del_mas_reciente_al_mas_viejo()
    {
        var service = Service();
        await service.RecordAsync(Guid.NewGuid(), "a@example.com", AdminActions.ExportUsers, null, null, default);
        await Task.Delay(5);
        await service.RecordAsync(Guid.NewGuid(), "b@example.com", AdminActions.Sync, Guid.NewGuid(), new string('d', 900), default);

        var recent = await service.GetRecentAsync(10, default);

        Assert.Equal(AdminActions.Sync, recent[0].Action);
        Assert.Equal(500, recent[0].Details!.Length);
        Assert.Equal(AdminActions.ExportUsers, recent[1].Action);
    }
}
