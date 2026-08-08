package io.github.suriyadi15.qrishook.merchant

import io.github.suriyadi15.qrishook.domain.ObservedNotification
import io.github.suriyadi15.qrishook.domain.QrisPaymentInfo

object DanaMerchantParser : MerchantParser() {
    override val merchantId = "dana"
    override val displayName = "DANA"
    override val merchantPackages = listOf("id.dana")

    private val paymentPattern = Regex(
        """(?i)\bRp\.?\s*([0-9][0-9.,]*)\s+diterima\s+(?:dari\s+)?(.+?)\s*\.?\s*$""",
    )

    override fun parsePaymentInfo(notification: ObservedNotification): QrisPaymentInfo? {
        val match = paymentPattern.find(notification.combinedText) ?: return null
        val amount = parseAmount(match.groupValues[1])
            ?: return null
        val senderName = match.groupValues[2].trim().ifBlank { null }

        return QrisPaymentInfo(
            amount = amount,
            senderName = senderName,
            paymentSource = null,
        )
    }

    private fun parseAmount(raw: String): Long? {
        val amount = raw
            .replace(".", "")
            .replace(",", "")
            .filter { it.isDigit() }
            .toLongOrNull()
        return amount?.takeIf { it > 0 }
    }
}
