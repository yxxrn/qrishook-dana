package io.github.suriyadi15.qrishook.merchant

import io.github.suriyadi15.qrishook.domain.ObservedNotification
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DanaMerchantParserTest {
    @Test
    fun parserIsRegisteredAndParsesCapturedSample() {
        assertTrue(MerchantRegistry.builtInParsers.any { it.merchantId == "dana" })
        assertTrue(DanaMerchantParser.merchantPackages.contains("id.dana"))

        val event = DanaMerchantParser.parse(
            notification(
                sourcePackage = "id.dana",
                title = "Pembayaran Masuk",
                text = "Rp10 diterima DANA Bisnis.",
            ),
        )

        assertNotNull(event)
        assertEquals("dana", event?.merchantId)
        assertEquals(10L, event?.payment?.amount)
        assertEquals("IDR", event?.payment?.currency)
        assertEquals("DANA Bisnis", event?.payment?.senderName)
        assertNull(event?.payment?.paymentSource)
    }

    @Test
    fun parsesAmountWithSeparatorsAndDariVariant() {
        val event = DanaMerchantParser.parse(
            notification(
                sourcePackage = "id.dana",
                title = "Pembayaran Masuk",
                text = "Rp 1.500.000 diterima dari Budi Santoso",
            ),
        )

        assertNotNull(event)
        assertEquals(1_500_000L, event?.payment?.amount)
        assertEquals("Budi Santoso", event?.payment?.senderName)
    }

    @Test
    fun canHandleRejectsDifferentPackage() {
        assertFalse(
            DanaMerchantParser.canHandle(
                notification(
                    sourcePackage = "com.other.app",
                    title = "Pembayaran Masuk",
                    text = "Rp10 diterima DANA Bisnis.",
                ),
            ),
        )
    }

    @Test
    fun rejectsNotificationWithoutAmount() {
        val event = DanaMerchantParser.parse(
            notification(
                sourcePackage = "id.dana",
                title = "Pembayaran Masuk",
                text = "Transfer diterima.",
            ),
        )

        assertNull(event)
    }

    private fun notification(
        sourcePackage: String,
        title: String,
        text: String,
    ) = ObservedNotification(
        sourcePackage = sourcePackage,
        sourceApp = "Merchant",
        title = title,
        text = text,
        bigText = "",
        postedAtMillis = 1_700_000_000_000,
    )
}
