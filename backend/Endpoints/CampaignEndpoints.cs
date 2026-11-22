using backend.Services;

namespace backend.Endpoints;

/// <summary>
/// QR campaigns. One public route — the site reports that it was opened through a
/// campaign link — and the panel's routes, behind the same admin gate as the rest of it.
/// </summary>
public static class CampaignEndpoints
{
    public static void MapCampaignEndpoints(this WebApplication app)
    {
        // Answers 204 whatever the code: an unknown one is ignored, and saying so would let
        // anyone enumerate the codes that exist.
        app.MapPost("/api/campaigns/visit", async (
            CampaignVisitRequest request,
            HttpContext http,
            CampaignService campaigns,
            CancellationToken cancellationToken) =>
        {
            await campaigns.RecordVisitAsync(request.Code, request.DeviceId, http, cancellationToken);
            return Results.NoContent();
        }).RequireRateLimiting("campaign");

        var group = app.MapGroup("/api/admin/campaigns")
            .RequireAuthorization()
            .AddEndpointFilter(AdminEndpoints.RequireAdmin);

        group.MapGet("", async (CampaignService campaigns, CancellationToken cancellationToken) =>
            Results.Ok(await campaigns.ListAsync(cancellationToken)));

        group.MapGet("/{id:guid}/users", async (Guid id, CampaignService campaigns, CancellationToken cancellationToken) =>
            await campaigns.GetUsersAsync(id, cancellationToken) is { } users ? Results.Ok(users) : Results.NotFound());

        group.MapPost("", async (
            CampaignTitleRequest request,
            System.Security.Claims.ClaimsPrincipal principal,
            CampaignService campaigns,
            AdminAuditService audit,
            CancellationToken cancellationToken) =>
        {
            if (CampaignService.NormalizeTitle(request.Title) is not { } title)
            {
                return MissingTitle();
            }

            var campaign = await campaigns.CreateAsync(title, cancellationToken);
            var (adminId, adminEmail) = AdminEndpoints.Actor(principal);
            await audit.RecordAsync(adminId, adminEmail, AdminActions.CampaignCreated, null, $"{campaign.Code} · {campaign.Title}", cancellationToken);
            return Results.Ok(new { campaign.Id, campaign.Code, campaign.Title });
        });

        group.MapPut("/{id:guid}", async (
            Guid id,
            CampaignTitleRequest request,
            System.Security.Claims.ClaimsPrincipal principal,
            CampaignService campaigns,
            AdminAuditService audit,
            CancellationToken cancellationToken) =>
        {
            if (CampaignService.NormalizeTitle(request.Title) is not { } title)
            {
                return MissingTitle();
            }

            var campaign = await campaigns.RenameAsync(id, title, cancellationToken);
            if (campaign is null)
            {
                return Results.NotFound();
            }

            var (adminId, adminEmail) = AdminEndpoints.Actor(principal);
            await audit.RecordAsync(adminId, adminEmail, AdminActions.CampaignRenamed, null, $"{campaign.Code} · {campaign.Title}", cancellationToken);
            return Results.Ok(new { campaign.Id, campaign.Code, campaign.Title });
        });

        group.MapPost("/{id:guid}/reset-visits", async (
            Guid id,
            System.Security.Claims.ClaimsPrincipal principal,
            CampaignService campaigns,
            AdminAuditService audit,
            CancellationToken cancellationToken) =>
        {
            var campaign = await campaigns.ResetVisitsAsync(id, cancellationToken);
            if (campaign is null)
            {
                return Results.NotFound();
            }

            var (adminId, adminEmail) = AdminEndpoints.Actor(principal);
            await audit.RecordAsync(adminId, adminEmail, AdminActions.CampaignVisitsReset, null, $"{campaign.Code} · {campaign.Title}", cancellationToken);
            return Results.NoContent();
        });

        group.MapDelete("/{id:guid}", async (
            Guid id,
            System.Security.Claims.ClaimsPrincipal principal,
            CampaignService campaigns,
            AdminAuditService audit,
            CancellationToken cancellationToken) =>
        {
            var campaign = await campaigns.DeleteAsync(id, cancellationToken);
            if (campaign is null)
            {
                return Results.NotFound();
            }

            var (adminId, adminEmail) = AdminEndpoints.Actor(principal);
            await audit.RecordAsync(adminId, adminEmail, AdminActions.CampaignDeleted, null, $"{campaign.Code} · {campaign.Title}", cancellationToken);
            return Results.NoContent();
        });
    }

    private static IResult MissingTitle() =>
        Results.BadRequest(new { message = "Poné un título para la campaña.", code = "title_required" });
}

public sealed record CampaignVisitRequest(string? Code, string? DeviceId);

public sealed record CampaignTitleRequest(string? Title);
