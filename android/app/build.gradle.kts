plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.loyaltyreward"
    compileSdk = 34

    defaultConfig {
        minSdk = 26
        targetSdk = 34
        versionCode = 9
        versionName = "1.6.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    flavorDimensions += "appType"
    productFlavors {
        create("customer") {
            dimension = "appType"
            applicationId = "com.loyaltyreward.customer"
            manifestPlaceholders["appName"] = "Loyalty Reward"
            manifestPlaceholders["appIcon"] = "@mipmap/ic_launcher_customer"
            manifestPlaceholders["appRoundIcon"] = "@mipmap/ic_launcher_customer_round"
            buildConfigField("String", "START_URL", "\"https://appassets.androidplatform.net/assets/index.html\"")
            buildConfigField("String", "APP_NAME", "\"Loyalty Reward\"")
        }
        create("owner") {
            dimension = "appType"
            applicationId = "com.loyaltyreward.owner"
            manifestPlaceholders["appName"] = "Store Terminal"
            manifestPlaceholders["appIcon"] = "@mipmap/ic_launcher_owner"
            manifestPlaceholders["appRoundIcon"] = "@mipmap/ic_launcher_owner_round"
            buildConfigField("String", "START_URL", "\"https://appassets.androidplatform.net/assets/owner.html\"")
            buildConfigField("String", "APP_NAME", "\"Store Terminal\"")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.11.0")
}
