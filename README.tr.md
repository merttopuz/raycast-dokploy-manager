<p align="center">
  <img src="media/icon.png" width="128" alt="Raycast için Dokploy" />
</p>

<h1 align="center">Raycast için Dokploy Manager</h1>

<p align="center">
  <a href="https://dokploy.com">Dokploy</a> sunucularınızı Raycast'ten çıkmadan yönetin.
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <b>Türkçe</b>
</p>

<p align="center">
  <a href="#kuruluş">Kuruluş</a> ·
  <a href="#komutlar">Komutlar</a> ·
  <a href="#raycast-aiya-sorun">Raycast AI</a> ·
  <a href="#verileriniz">Verileriniz</a>
</p>

<p align="center">
  <img src="media/services.png" width="700" alt="Raycast'te bir Dokploy projesinin servislerine göz atmak" />
</p>

Projelerinize göz atın, servisleri deploy edip yeniden başlatın, logları okuyun, bir build'in neden başarısız olduğunu öğrenin - hepsi Raycast penceresinden. İstediğiniz kadar Dokploy sunucusu bağlayın ve aralarında tek tuşla geçiş yapın.

## Kuruluş

1. Dokploy panelinizde **Settings → Profile → API/CLI** bölümüne gidip bir API anahtarı oluşturun.
2. Raycast'te **Manage Accounts** komutunu çalıştırın ve sunucu adresinizi bu anahtarla birlikte ekleyin.

<p align="center">
  <img src="media/setup.png" width="700" alt="Raycast'te Dokploy hesabı eklemek" />
</p>

Hepsi bu. Anahtarınız kaydederken sunucuya karşı doğrulanır; bir şey yanlışsa bir sonraki deploy denemenizde değil, o anda haberiniz olur.

Birden fazla sunucunuz mu var? Hepsini ekleyin. Çoğu komut aktif olarak işaretlediğiniz hesap üzerinde çalışır; bunu **Manage Accounts**'tan ya da arama çubuğundaki açılır menüden değiştirebilirsiniz.

## Komutlar

**Browse Projects** - Projeleriniz ve ortamlarınız arasında gezinin, içlerindeki her servise müdahale edin: uygulamalar, Docker Compose yığınları ve PostgreSQL, MySQL, MariaDB, MongoDB, Redis, LibSQL veritabanları. `⌘N` ile proje oluşturun, `⌃X` ile silin.

**Search Services** - Sunucudaki her servis tek bir aranabilir listede. Adını bildiğiniz ve projeler arasında tıklamak istemediğiniz zamanlar için.

**Deploy** - Komutu yazın, servis adını yazın, Enter'a basın. Hiçbir pencere açılmaz: Raycast'in kök aramasından yeniden deploy'a giden en kısa yol budur. İsimler AI'ın eşleştirdiği şekilde eşleştirilir, yani belirsiz bir isim tahmin edilmek yerine hangisini kastettiğiniz size sorulur.

**Recent Deployments** - Son ne deploy edildi, işe yaradı mı, yaramadıysa build logu ne diyor. Takılan bir build'i sonlandırabilir, sıradakini iptal edebilir ya da daha eski bir build'e geri dönebilirsiniz.

**Deploy Template** - Dokploy yüzlerce hazır Compose yığınıyla gelir: n8n, Plausible, Uptime Kuma, Supabase ve diğerleri. Ada veya etikete göre arayın, ardından bir proje ve ortam seçip panele hiç dokunmadan kurun.

Herhangi bir şablonda `⌘D`'ye basarak, kurmaya karar vermeden önce neyi gerçekten oluşturacağını görün: istediği alan adları, kuracağı ortam değişkenleri, yazacağı yapılandırma dosyaları ve Dokploy'un kurulum anında sizin için üreteceği değerler. Compose dosyasının kendisi de bir tuş ötede. Sürekli döndüğünüz şablonları `⌘B` ile yer imlerine ekleyebilirsiniz; listenin en üstünde kendi bölümlerine yükselirler.

**Service Status** - Her şeye göz kulak olan bir menü çubuğu öğesi. Bir servis düştüğü anda kırmızıya döner, yani aramaya gitmeden haberiniz olur. Menüden herhangi bir şeyi deploy edin, yeniden başlatın ya da deployment'larına atlayın.

Yalnızca üzerindeki servisleri değil, sunucunun kendisini de izler: her instance için disk, CPU ve bellek, ayrıca Docker'ın kendi disk kullanımı. Bir Dokploy sunucusu çoğunlukla dolan diskten ölür ve düşen bir servisin aksine bunu önceden haber verir - bu yüzden ikon onun için de kırmızıya döner ve bu konuda bir şey yapabilmeniz için Docker'ın temizleme komutları aynı menüde durur. İmajları ya da durmuş konteynerleri temizlemek yalnızca yeniden üretilebilir şeyleri atar; volume temizlemek veriyi atar, ve iki kez soran da odur.

**Manage Accounts** - Dokploy sunucularınızı ekleyin, düzenleyin, kaldırın ve aralarında geçiş yapın.

Projeler ve servisler kendilerini gerçekten kullandığınız sıraya dizer: her gün deploy ettiğiniz servis listenin tepesine çıkar, Mart'ta bir kez dokunduğunuz aşağı iner. Bu bir şekilde yanılırsa, **Reset Ranking** öğeyi başladığı yere geri koyar.

## Bir servise neler yapabilirsiniz

Deploy, yeniden deploy, başlat, durdur, reload ve sil - ayrıca loglarını okuyun, alan adlarını yönetin, yedeklerini ve zamanlanmış görevlerini çalıştırın, Dokploy panelinde açın. Veritabanları yeniden deploy yerine yeniden inşa edilebilir; bu, Dokploy'un her servis türü için sunduğunun aynısıdır.

Bir servisi düşüren her şey önce onay ister.

### Loglar

`⌘L` bir servisin loglarını açar. `⌘F` onları takip eder, yani yeni satırlar bir sonraki yenilemede değil siz izlerken gelir.

Bir Compose yığını birkaç konteyner çalıştırır ve Dokploy her seferinde birini okur, bu yüzden `⌘T` aralarında geçiş yapar. Çalışan olan sizin için seçilir.

### Alan adları

Bir uygulama ya da Compose yığınında `⌘⇧U` alan adlarını listeler, birini tarayıcıda açar, yenilerini ekler ya da kaldırır.

Asıl bilinmeye değer kısım ekleme. `⌘G` sunucunuza zaten çözümlenen bir alan adı üretir; DNS'iniz hazır değilken bir yığını erişilebilir yapmanın en hızlı yolu budur. Kendi host'unuzu getiriyorsanız, `⌘T` kaydetmeden önce onun bu sunucuyu gösterdiğini doğrular - Traefik yönlendirmede başarısız olduktan sonra değil. HTTPS hangi sertifikanın verileceğini sorar; etkili olması için servisin yeniden deploy edilmesi gerekir ve bildirim bunu söyler.

### Yedekler

`⌘⇧B` bir Compose yığını ya da Postgres, MySQL, MariaDB, MongoDB, LibSQL veritabanı için yapılandırılmış yedekleri, her birinin en son ne zaman çalıştığını ve işe yarayıp yaramadığını gösterir. Cron'unu beklemeden birini şimdi çalıştırmak için Enter'a basın.

Bir yedeği yapılandırmak bir S3 hedefi yapılandırmak demektir; Dokploy buna yalnızca owner ve admin'lerin izin verir, dolayısıyla o kısım panelde kalır. Raycast'ten sorulmaya değer soru, onu çalıştırmaktır.

### Zamanlanmış görevler

`⌘⇧T` bir uygulamaya ya da Compose yığınına bağlı cron komutlarını listeler ve birini istediğiniz an çalıştırır. Her çalıştırma bir deployment olarak kaydedilir, böylece komutun gerçekte ne yazdırdığını okuyabilirsiniz. Dokploy son on tanesini saklar.

### Ortam değişkenleri

Herhangi bir servisin değişkenleri tek tuş uzağınızda (`⌘⇧E`) ve yerinde düzenlenebilir. Değerler siz **Reveal Values**'a basana kadar maskelidir, çünkü kendi makinenizde kendi ortamınızı okumak risk değil - ekran paylaşırken okumak risk, ve Raycast'e tam da o sırada uzanırsınız. Sahip olan servisler için build argümanları ve build secret'ları da orada.

Kaydetmek değişkenleri saklar ama hiçbir şeyi yeniden başlatmaz, tıpkı Dokploy'un kendisi gibi: etkili olmalarını istediğinizde servisi yeniden deploy edin.

### Veritabanı bağlantı dizeleri

Postgres, MySQL, MariaDB, MongoDB, Redis ve LibSQL'in her biri size doğrudan panoya bir bağlantı dizesi verir:

- **External** (`⌘⇧U`) - dizüstünüzdeki TablePlus'a ya da `psql`'e yapıştırdığınız. Yalnızca veritabanının bir dış portu varsa vardır; yoksa eklenti bağlanamayacak bir şey kopyalamak yerine bunu söyler.
- **Internal** (`⌘⌥U`) - başka bir servisin ortam değişkenlerine yapıştırdığınız, veritabanına Dokploy'un kendi ağı üzerinden ulaşan.

Bunlar, Dokploy panelinin her veritabanı türü için gösterdiğiyle eşleşecek şekilde, tuhaflıklarıyla birlikte kurulur. Bağlantı dizeleri ve parolalar gizlenmiş olarak kopyalanır, böylece Raycast'in pano geçmişinde kalmazlar.

## Raycast AI'ya sorun

Eklenti Raycast AI ile çalışır, yani ne istediğinizi söylemeniz yeterli:

- "Dokploy'da düşen bir şey var mı?"
- "api'nin son deploy'u neden başarısız oldu?"
- "storefront backend'i yeniden deploy et"
- "worker'dan son 50 log satırını göster"

<p align="center">
  <img src="media/ai.png" width="700" alt="Raycast AI'ya herhangi bir Dokploy servisinin düşüp düşmediğini sormak" />
</p>

Bir şey deploy edilmeden, başlatılmadan, durdurulmadan ya da yeniden başlatılmadan önce Raycast size tam olarak ne olacağını gösterir ve onayınızı bekler. Bir servisi silmek AI'ın hiç yapabileceği bir şey değildir.

Bir isim belirsizse - diyelim iki projede de `api` adlı bir servis var - sizin için biri seçilmek yerine hangisini kastettiğiniz sorulur.

## Ayarlar

- **Log Lines** - bir logu açtığınızda ne kadarının çekileceği. Varsayılan 200; Dokploy en fazla 10000'e izin verir.
- **Watch** (Service Status) - menü çubuğunun bağladığınız her sunucuya mı yoksa yalnızca aktif olana mı göz kulak olacağı. Varsayılan hepsi.
- **Disk Warning** (Service Status) - menü çubuğunun bir sunucunun diskini sorun saymaya başlaması için ne kadar dolması gerektiği. Varsayılan %90. Dokploy kendi CPU ve bellek eşiklerini taşır ama disk için bir eşiği yoktur, dolayısıyla eklentinin sormak zorunda olduğu tek sayı budur. Dokploy'un monitoring'inin açık olmasını gerektirir.

## Verileriniz

Bu eklenti kendi Dokploy sunucunuzla konuşur. Analitik yoktur ve başka hiçbir yere bir şey gönderilmez - kesin olarak belirtmeye değer tek bir istisna dışında.

**Deploy Template**, sizin sunucunuzdan değil, Dokploy'un `templates.dokploy.com` adresindeki herkese açık şablon kayıt defterinden okur: her şablonun logosu ve, bir şablonun detaylarını açtığınızda, onun `template.toml` ve Compose dosyası. Kendi sunucunuzda bunları sunan bir uç nokta yok, dolayısıyla kayıt defteri tek kaynak - bu, Dokploy sunucunuzun kendisinin çektiği aynı herkese açık katalog. O host, ziyaret ettiğiniz her web sitesi gibi IP adresinizi görür. Bu isteklerle sunucunuz, projeleriniz ya da anahtarınız hakkında hiçbir şey gönderilmez ve başka hiçbir komut oraya dokunmaz. **Deploy Template**'i hiç açmazsanız, eklenti yalnızca kendi sunucunuzla konuşur.

API anahtarlarınız Raycast'in şifreli yerel deposunda tutulur ve kendi sunucunuza istek imzalamak dışında makinenizden hiç çıkmaz. Ortam değişkenleri, build secret'ları ve veritabanı parolaları Raycast AI'ya hiçbir zaman gösterilmez.

Secret'lar ayrıca diske hiç yazılmaz. Raycast, listeler anında açılsın diye komut sonuçlarını önbelleğe alır, ama o önbellek şifreli değildir - bu yüzden ortam değişkenleri ve veritabanı kimlik bilgileri yalnızca siz görmek istediğinizde çekilir, bellekte tutulur ve önbelleğin tamamen dışında bırakılır. Bir veritabanının kimlik bilgilerinin liste çizilirken değil, tam da onları kopyaladığınız anda okunmasının sebebi de budur. Sunucu sağlığı önbelleğe alınır, çünkü monitoring token'ı geride kalır ve yalnızca ölçümler geri döner.

AI komutlarını kullanmadan önce bilinmeye değer bir şey: AI'ın sizin adınıza okuduğu her şey, model size cevap verebilsin diye Raycast AI'ya gönderilir - sorarsanız **log içerikleri** dahil. Loglar uygulamanızın ham çıktısıdır, yani uygulamanız token ya da kişisel veri yazdırıyorsa o da beraberinde gider. Bu önemli olduğunda, her şeyi makinenizde tutan normal komutları kullanın.

## Lisans

MIT
