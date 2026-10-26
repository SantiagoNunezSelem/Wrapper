using System.Security.Cryptography;

namespace backend.Services;

/// <summary>
/// The short code a report is known by: six characters like <c>K7M2QX</c>. It replaces a
/// counter on purpose. "Ticket 5" tells whoever reads it that they are the fifth person to ever
/// write in, and a code that climbs by one is a code anyone can guess the neighbours of; this
/// one carries no order and no count.
///
/// <para><b>The pattern.</b> Digits and consonants only. No vowels, so six random characters can
/// never spell a word. No <c>0 O 1 I L</c>, which read as one another on a phone and in a
/// message. No <c>U</c> or <c>Y</c> either, which are vowels when it suits them. That leaves 27
/// symbols — 27⁶, about 387 million codes — and every one can be read out loud and typed back
/// without asking "is that a zero?".</para>
///
/// <para><b>Uniqueness.</b> Not the generator's job: it is random, and what makes two reports
/// never share a code is the unique index on the column, with the service picking another code
/// when an insert is refused. At this scale that happens once in tens of thousands of reports
/// at most, so the retry is a safeguard, not a code path anyone will watch.</para>
/// </summary>
public static class TicketCodes
{
    public const int Length = 6;

    public const string Alphabet = "23456789BCDFGHJKMNPQRSTVWXZ";

    /// <summary>Cryptographically random, not <c>Random</c>: a predictable code would bring the order back.</summary>
    public static string Generate() =>
        string.Create(Length, 0, static (span, _) =>
        {
            for (var index = 0; index < span.Length; index++)
            {
                span[index] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
            }
        });
}
