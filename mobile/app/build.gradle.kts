plugins {
    id("com.android.application") version "8.13.2"
    id("org.jetbrains.kotlin.android") version "2.3.10"
}

android {
    namespace = "os.unfeal.mobile"
    compileSdk = 36
    defaultConfig {
        applicationId = "os.unfeal.mobile"
        minSdk = 24
        targetSdk = 35
        versionCode = 3
        versionName = "0.3.0"
        ndk { abiFilters += "arm64-v8a" }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation("com.google.ai.edge.litertlm:litertlm-android:0.18.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
}

val sharedBrandAssets = tasks.register<Copy>("copySharedBrandAssets") {
    from(rootProject.file("../src/assets/cherry-wallpaper.png"))
    from(rootProject.file("../public/unfeal-icon.jpg"))
    into(layout.buildDirectory.dir("generated/brand-assets"))
}
android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/brand-assets"))
tasks.named("preBuild") { dependsOn(sharedBrandAssets) }
