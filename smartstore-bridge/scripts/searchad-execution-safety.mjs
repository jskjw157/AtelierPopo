import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';

// No directory/file exemption: each reviewed import or initiation AST node is
// pinned with its enclosing guard/delegation context and exact occurrence count.
// Capability injection sites are explicit records too. Changes require review.
export const REVIEWED_TRANSPORT_BOUNDARIES = Object.freeze([
  Object.freeze({"file":"src/bootstrap-v05.js","kind":"network_capability_transfer","nodeSha256":"2cc719cd51bd0f56b777265f8dc24e68392dff8c6882c6ca742d9fc7a3233aef","contextSha256":"d030f13dcc7c0caba0ff8647aaa2c0278b2010f48fcffb5c230cefb8ddfa3264","contextType":"FunctionDeclaration","contextName":"bootstrapV05","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Application composition injects its explicit transport into the SearchAd client and hierarchy bootstrap; no dispatch here.","testRefs":["test/postgres-searchad-application-bootstrap.integration.test.js","test/searchad-validation.test.js"]}),
  Object.freeze({"file":"src/bootstrap-v05.js","kind":"network_capability_transfer","nodeSha256":"1b9bd6bb45e89af1f82406387ad37a087e30dec44df935b2a47158a6678cbe55","contextSha256":"d030f13dcc7c0caba0ff8647aaa2c0278b2010f48fcffb5c230cefb8ddfa3264","contextType":"FunctionDeclaration","contextName":"bootstrapV05","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Application composition injects its explicit transport into the SearchAd client and hierarchy bootstrap; no dispatch here.","testRefs":["test/postgres-searchad-application-bootstrap.integration.test.js","test/searchad-validation.test.js"]}),
  Object.freeze({"file":"src/cafe24/auth.js","kind":"network_initiation","nodeSha256":"53ed39299012da81e3149f9c345327df7809a3e1b42bad979470503280e8ee95","contextSha256":"221d7c26e1f6dcbb0785aa9d69f70a493f7dd893022afcfacefb1bb3080fa8c5","contextType":"MethodDefinition","contextName":"Cafe24TokenProvider.refresh","occurrences":1,"reason":"Existing Cafe24 OAuth refresh transport; configured token URL, redirect denial.","testRefs":["test/cafe24-auth-client.test.js"]}),
  Object.freeze({"file":"src/cafe24/client.js","kind":"network_initiation","nodeSha256":"bf0ed130d6a836c89892163865da5eccaacfcf44ff184e235129b645e1a7dc19","contextSha256":"51b80c6c2668b430d07fb865a05df8caa4c6e6b14ff45497fdcf04ac3cc5b457","contextType":"MethodDefinition","contextName":"Cafe24AdminClient.request","occurrences":1,"reason":"Existing Cafe24 GET-only configured same-origin client; no new endpoint authority.","testRefs":["test/cafe24-auth-client.test.js"]}),
  Object.freeze({"file":"src/drive/auth.js","kind":"network_initiation","nodeSha256":"213b591f96d4092a621b5f550d247bcab3325efc8c319ecd01e7257dc9ec8906","contextSha256":"4234fb096e884ba1f857fc152522120973827e42e2bd3ae483c3eb4aa0b656fd","contextType":"MethodDefinition","contextName":"GoogleServiceAccountTokenProvider.issue","occurrences":1,"reason":"Existing configured Google OAuth transport; outside SearchAd execution authority.","testRefs":["test/drive-auth.test.js"]}),
  Object.freeze({"file":"src/drive/auth.js","kind":"network_initiation","nodeSha256":"fbba12ad83dfd1b40b20b6ca051152238c0c1771ae53a843d369e350a0812614","contextSha256":"caef971b0d1e65057b9c101d519e45fccff0e699fdbd16503801f523a400ebf5","contextType":"MethodDefinition","contextName":"GoogleOAuthRefreshTokenProvider.issue","occurrences":1,"reason":"Existing configured Google OAuth transport; outside SearchAd execution authority.","testRefs":["test/drive-auth.test.js"]}),
  Object.freeze({"file":"src/drive/auth.js","kind":"network_capability_transfer","nodeSha256":"1d86658a20d3f3a694c84a6c2ba04571716d208edf601d6057a6f125d6f51d43","contextSha256":"cb6934cfb95c9338792ec2299be73db0f2186e7e7d2a8689e0c99f4e0de6cf93","contextType":"FunctionDeclaration","contextName":"createGoogleTokenProvider","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Existing configured Google OAuth transport; outside SearchAd execution authority.","testRefs":["test/drive-auth.test.js"]}),
  Object.freeze({"file":"src/drive/auth.js","kind":"network_capability_transfer","nodeSha256":"cc0acd18e20e1f44eb0fe58410b4128c748037ecbb9d8405e6c2c6684812803e","contextSha256":"cb6934cfb95c9338792ec2299be73db0f2186e7e7d2a8689e0c99f4e0de6cf93","contextType":"FunctionDeclaration","contextName":"createGoogleTokenProvider","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Existing configured Google OAuth transport; outside SearchAd execution authority.","testRefs":["test/drive-auth.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"network_capability_transfer","nodeSha256":"728605c92cf6a14a67e9fc73c23eb1486d6fc6715383dcb10d3c070ef6e7492b","contextSha256":"c0dc84f1981fd6a771ca0a42c062479d89616143cfe4fcf518f1d4aae9c0e4f3","contextType":"MethodDefinition","contextName":"GoogleDriveClient.constructor","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"network_initiation","nodeSha256":"32a828fcb72be94e66c181e1a1d6ccfbf1a1a2fc3e2b180918ea8b8f69e892b6","contextSha256":"b76cad7d41c97b6fd2e67ff044a5fcde0b613ee05b49cb1887f02f5ee2fdefc9","contextType":"MethodDefinition","contextName":"GoogleDriveClient.request","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"85ee14ab2b3bed5eca676de97b9488fc71e6fd1a63f44591725cedb31962e556","contextSha256":"7ab333e1c1974793862a4746de7171997660b593dcba84f54078ebacf86bf878","contextType":"MethodDefinition","contextName":"GoogleDriveClient.get","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"a7fcd9a35e4e02a77c62f03db376152e40fd136efb623f9efeecb650658a4ae6","contextSha256":"d842a06b734fb616ebf0381e6d7e0a6bb9766f49747e99f89096583a235b0e98","contextType":"MethodDefinition","contextName":"GoogleDriveClient.post","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"6803b39e6f6b60aa586bcdb398013dede248db934837ea74ef0ffe2134c7661c","contextSha256":"7be3bb428ee2f991d65193c26ea4becf92fb38d280007719b456e07c9d3ed335","contextType":"MethodDefinition","contextName":"GoogleDriveClient.patch","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"7618df4aefbdfc59aad839e90300e078b4a45986a5e213fb52bc0935a396639e","contextSha256":"f20ded0c6917b20c2254c3e2d9a675e03b0a531619f26b7a448fc49fa5fdf1e0","contextType":"MethodDefinition","contextName":"GoogleDriveClient.delete","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"2f567aa7fffad566056244164019553240a1a635186b4ccb81871c7d8dfa5a50","contextSha256":"b366a65caa2423a69b44189aa245ff29d74d8b0d6bceedbccf2c498fa7debe97","contextType":"MethodDefinition","contextName":"GoogleDriveClient.createResumableSession","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"a6b174b55a6410a4c19feef68440b91fb146e800448c977abe5e2972a341a6b2","contextSha256":"14d67f6d237db390e3d0b2ba5188b27b02c18e4f59f5eab538e834eefe6d5232","contextType":"MethodDefinition","contextName":"GoogleDriveClient.uploadLocalFile","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/drive/client.js","kind":"raw_client_delegation","nodeSha256":"a6b174b55a6410a4c19feef68440b91fb146e800448c977abe5e2972a341a6b2","contextSha256":"5468127891d896b32fd2b8478c5c337a915e82242795d0195d67f286fee9fcfd","contextType":"MethodDefinition","contextName":"GoogleDriveClient.replaceLocalFileContent","occurrences":1,"reason":"Existing Drive client transport/delegation with configured origin and upload guards; not a SearchAd service exemption.","testRefs":["test/drive-client.test.js"]}),
  Object.freeze({"file":"src/http/server-v03.js","kind":"network_import","nodeSha256":"6dee6c38cf4c5eb693e5aa9d21e655dc54bb550c6d15578821beb40411741def","contextSha256":"9abdccaa323d8b33a9e6d9581d549006ab3068893db15303a9544e5baea2879f","contextType":"ImportDeclaration","contextName":"ImportDeclaration","occurrences":1,"reason":"Inbound HTTP listener module import only; no permission for outbound http.request/get calls.","testRefs":["test/searchad-http-access.test.js"]}),
  Object.freeze({"file":"src/http/server-v04.js","kind":"network_import","nodeSha256":"6dee6c38cf4c5eb693e5aa9d21e655dc54bb550c6d15578821beb40411741def","contextSha256":"9abdccaa323d8b33a9e6d9581d549006ab3068893db15303a9544e5baea2879f","contextType":"ImportDeclaration","contextName":"ImportDeclaration","occurrences":1,"reason":"Inbound HTTP listener module import only; no permission for outbound http.request/get calls.","testRefs":["test/searchad-http-access.test.js"]}),
  Object.freeze({"file":"src/http/server-v05.js","kind":"network_import","nodeSha256":"6dee6c38cf4c5eb693e5aa9d21e655dc54bb550c6d15578821beb40411741def","contextSha256":"9abdccaa323d8b33a9e6d9581d549006ab3068893db15303a9544e5baea2879f","contextType":"ImportDeclaration","contextName":"ImportDeclaration","occurrences":1,"reason":"Inbound HTTP listener module import only; no permission for outbound http.request/get calls.","testRefs":["test/searchad-http-access.test.js"]}),
  Object.freeze({"file":"src/http/server.js","kind":"network_import","nodeSha256":"6dee6c38cf4c5eb693e5aa9d21e655dc54bb550c6d15578821beb40411741def","contextSha256":"9abdccaa323d8b33a9e6d9581d549006ab3068893db15303a9544e5baea2879f","contextType":"ImportDeclaration","contextName":"ImportDeclaration","occurrences":1,"reason":"Inbound HTTP listener module import only; no permission for outbound http.request/get calls.","testRefs":["test/searchad-http-access.test.js"]}),
  Object.freeze({"file":"src/naver/auth.js","kind":"network_initiation","nodeSha256":"fb3ac0e49c2eb35339c809c6109ca13f8be1c3596213731db00ebad919d22303","contextSha256":"ebc34c805821a47e36cc0169907a7b52934e40a0b8111009149814f00fbb5461","contextType":"FunctionDeclaration","contextName":"issueAccessToken","occurrences":1,"reason":"Existing Naver Commerce token transport; outside SearchAd execution authority.","testRefs":["test/naver-auth.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"network_initiation","nodeSha256":"1af43af9454ee067e401950983580e4f8d3d43c25144a5438c4d123ad6b50a0b","contextSha256":"d2b89f8bbdf5010256071cdd3bdcb358202abc661a648b18a5b4c26bad778269","contextType":"MethodDefinition","contextName":"NaverCommerceClient.requestDetailed","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"raw_client_delegation","nodeSha256":"3a7485050b6872dbeb0d8438b4607ae9bef556277c48810b3b74211e64c5433e","contextSha256":"ab3f0f9a5303d92d57ef02a0f7714476ee6885f83a328cb035e2d86ba83d3dad","contextType":"MethodDefinition","contextName":"NaverCommerceClient.get","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"raw_client_delegation","nodeSha256":"94a69aa7620cfc4bbb9a2dbccde4145d7c820122b9c589db3dad4968a0d41bd6","contextSha256":"bd541ef9c37d65852058c071bb748d68d33e00fab73d520785972d364ab2ee28","contextType":"MethodDefinition","contextName":"NaverCommerceClient.post","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"raw_client_delegation","nodeSha256":"c3de1155d2e27c4dae7de78375f263d50af11573781329b8703d5e0ac464e69d","contextSha256":"10d6c1ba7bdbe7b96be0d08bd58914a93c5d513281eb25d5e596b70d68e04717","contextType":"MethodDefinition","contextName":"NaverCommerceClient.put","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"raw_client_delegation","nodeSha256":"5d57db9ef3b4b6e5d3152878c1806d174025eda0eba68aa9ed363b9db7744454","contextSha256":"23e57a91e3b8f570e0d15368c29aeacea9daa60db9c19c729b77739cb4483b75","contextType":"MethodDefinition","contextName":"NaverCommerceClient.patch","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"raw_client_delegation","nodeSha256":"f41ea7dc1caddedd7662faa7241b31245c48c6b99bdbea7f8993c5c6ea2b7051","contextSha256":"e88c5b0090d9416ebfcf3b6f00ad9f3a38a223c6cdd115508ae3ad1094c70b89","contextType":"MethodDefinition","contextName":"NaverCommerceClient.delete","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/client.js","kind":"raw_client_delegation","nodeSha256":"b431475f8605e73d196ef005a71075f7dd1686aa40a2f268681e6f9c1f99985b","contextSha256":"77d1484db8cc7aeaf6880feebdb3db7ce303004f1cb6f6df935c4f3bf8b4a725","contextType":"MethodDefinition","contextName":"NaverCommerceClient.head","occurrences":1,"reason":"Existing Naver Commerce transport/delegation with same-origin redirect and method handling.","testRefs":["test/naver-client.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/client.js","kind":"network_initiation","nodeSha256":"9b9df542a3fbf48b509b6fbf55e0d522b39117dc19fd385994ee676e999a6b35","contextSha256":"1db4bfe26c5810df8ce9295cc77463be4b040272bbbb4f043a9e4f1ba0ef6a23","contextType":"MethodDefinition","contextName":"NaverSearchAdClient.request","occurrences":1,"reason":"SearchAd authenticated client transport entry; signatures, method retry and redirect contracts.","testRefs":["test/searchad-client.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/gateway.js","kind":"raw_client_delegation","nodeSha256":"2f37ffd9238d68f09a1e17872bf626931a2ba0980e7b5f1e29af87b90fb897f9","contextSha256":"105849a3fa53f6ad67f6dcd49101a03d96b1b71f4f43d295a0e77d6595654fcb","contextType":"MethodDefinition","contextName":"SearchAdOperationGateway.executeReportJob","occurrences":1,"reason":"Exact gateway raw-client delegations after descriptor/Customer/gate checks; ordinary, canary, report registration or owned-job response consumption.","testRefs":["test/searchad-gateway-capability.test.js","test/searchad-gateway-active-canary.test.js","test/searchad-reporting-jobs.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/gateway.js","kind":"raw_client_delegation","nodeSha256":"ba26bf3307095936f5e92a37730dede69c386107e618e5517b2401bd3017bca8","contextSha256":"9135a2a7fe195c6b51fc46447616c63edbcd033057fee772d5178edf020ada4e","contextType":"MethodDefinition","contextName":"SearchAdOperationGateway.consumeReportDownloadResponse","occurrences":1,"reason":"Exact gateway raw-client delegations after descriptor/Customer/gate checks; ordinary, canary, report registration or owned-job response consumption.","testRefs":["test/searchad-gateway-capability.test.js","test/searchad-gateway-active-canary.test.js","test/searchad-reporting-jobs.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/gateway.js","kind":"raw_client_delegation","nodeSha256":"74ec006b84c478db73daf74623b99de5a49abb6d4caf056c156e795fb9437414","contextSha256":"8a5abad3c76b499e4b24f04621f4840f7e642f02e1defe90edd807fff5544138","contextType":"MethodDefinition","contextName":"SearchAdOperationGateway.execute","occurrences":1,"reason":"Exact gateway raw-client delegations after descriptor/Customer/gate checks; ordinary, canary, report registration or owned-job response consumption.","testRefs":["test/searchad-gateway-capability.test.js","test/searchad-gateway-active-canary.test.js","test/searchad-reporting-jobs.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/gateway.js","kind":"raw_client_delegation","nodeSha256":"2ba72bc1941e54deecc48691e3abc1753eb4dd5d8632eb80de94245d6b848592","contextSha256":"6b97e46d4b81662838be0d3214fda881f8d09eb0e543a03302ffb20320f911cc","contextType":"MethodDefinition","contextName":"SearchAdOperationGateway.executeCanary","occurrences":1,"reason":"Exact gateway raw-client delegations after descriptor/Customer/gate checks; ordinary, canary, report registration or owned-job response consumption.","testRefs":["test/searchad-gateway-capability.test.js","test/searchad-gateway-active-canary.test.js","test/searchad-reporting-jobs.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/adgroup-create-service.js","kind":"network_capability_transfer","nodeSha256":"38b5af85cb4a5be6452433eb275d60de1bb5a3cc915b598469280b2de0a4f48d","contextSha256":"0df226c5632ba4e36f8ae440b93c9ecd268f93871fe0fcf584bf43528b12fbac","contextType":"MethodDefinition","contextName":"AdgroupCreateService.constructor","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Existing adgroup constructor injects transport only into the authentic account send fence; mutation protocol unchanged.","testRefs":["test/postgres-searchad-adgroup-create.integration.test.js","test/postgres-searchad-application-send-fence.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/bootstrap.js","kind":"network_capability_transfer","nodeSha256":"cc785f078efbbc8154eb42143f8a00341507bd293ca75d82f73e546c65878653","contextSha256":"77679c54d428fb8e33ab6845194bfa64155840a77e91848b50413a484674d01d","contextType":"FunctionDeclaration","contextName":"bootstrapSearchAdHierarchyRuntime","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Hierarchy bootstrap injects the explicitly selected transport into the existing production runtime.","testRefs":["test/postgres-searchad-hierarchy-http.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/campaign-cleanup-service.js","kind":"network_capability_transfer","nodeSha256":"38b5af85cb4a5be6452433eb275d60de1bb5a3cc915b598469280b2de0a4f48d","contextSha256":"f88e781fbbc5fa26c88e100525662ec388911ed092e0f3612b2e645c8a6c901d","contextType":"MethodDefinition","contextName":"CampaignCleanupService.constructor","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Existing internal campaign cleanup constructor injects transport into the authentic account fence; public cleanup stays disabled.","testRefs":["test/postgres-searchad-campaign-cleanup.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/campaign-create-service.js","kind":"network_capability_transfer","nodeSha256":"38b5af85cb4a5be6452433eb275d60de1bb5a3cc915b598469280b2de0a4f48d","contextSha256":"b2f9b1b2cd669b2cdc336223ac90807080bbeda454730bb44e975fe8a821297a","contextType":"MethodDefinition","contextName":"CampaignCreateService.constructor","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Existing campaign constructor injects transport into the authentic account send fence.","testRefs":["test/postgres-searchad-campaign-create.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/child-first-cleanup-service.js","kind":"network_capability_transfer","nodeSha256":"38b5af85cb4a5be6452433eb275d60de1bb5a3cc915b598469280b2de0a4f48d","contextSha256":"49654c81ae1fb0d236ba3ae402ceec8dff648f73471e260cc21abfce3aea0198","contextType":"MethodDefinition","contextName":"ChildFirstCleanupService.constructor","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Existing child-first cleanup constructor injects transport into the authentic account send fence.","testRefs":["test/postgres-searchad-application-send-fence.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/postgres-account-send-fence.js","kind":"network_initiation","nodeSha256":"524a9dac5d6f19c2b086a4510ce2fe1cb4f0391c79d102e677a59331e71633db","contextSha256":"3cd859d06967e1a13ca2b93ddbe440eee06c56e2b71d35fe97c8d3b1072fede3","contextType":"MethodDefinition","contextName":"PostgresAccountSendFence.fetch","occurrences":2,"reason":"Existing account-row transport initiation boundary; GET/HEAD observation and exact guarded mutation entry. Fence behavior is unchanged.","testRefs":["test/searchad-send-fence-method.test.js","test/postgres-searchad-application-send-fence.integration.test.js","test/postgres-searchad-suspend-send-fence.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/postgres-mutation-gateway.js","kind":"network_initiation","nodeSha256":"ec027e31f9a5edb119d4ce0737cb5b66fa35df45dbcc57ac5ced72a3b602b320","contextSha256":"74c386307539cd789cef347d139b651a55d8b236f9b2bd4565a8a51211b4a104","contextType":"FunctionDeclaration","contextName":"createPostgresMutationGateway","occurrences":1,"reason":"Private captured transport invocation inside the account fence; pins initiatedAt for report registration.","testRefs":["test/searchad-postgres-mutation-gateway.test.js","test/postgres-searchad-report-jobs.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/runtime-production.js","kind":"network_capability_transfer","nodeSha256":"78efd36f9d220dbc44821b813bca59b9ccbf504b3771ffb4240765811a363542","contextSha256":"bbb424d9d9948d12b252b1dfe4ee5f6e259cbf4f7946185037dcdc88c3291e3d","contextType":"FunctionDeclaration","contextName":"createProductionSearchAdHierarchyRuntime","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Inventory-only transport wrapper: exact origin, credential-free URL, redirects denied; upstream read-only gateway classification remains required.","testRefs":["test/postgres-searchad-inventory-http.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/runtime-production.js","kind":"network_capability_transfer","nodeSha256":"db893d706fa178fbc870dff50fdda0fb984b6020d38ee715c0fa030bf49912b7","contextSha256":"bbb424d9d9948d12b252b1dfe4ee5f6e259cbf4f7946185037dcdc88c3291e3d","contextType":"FunctionDeclaration","contextName":"createProductionSearchAdHierarchyRuntime","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Inventory-only transport wrapper: exact origin, credential-free URL, redirects denied; upstream read-only gateway classification remains required.","testRefs":["test/postgres-searchad-inventory-http.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/runtime-production.js","kind":"network_capability_transfer","nodeSha256":"fdb8fb3c9fe1000c1564ffb6e9d4e94b677db329be7c4d35fc729cf51228d86b","contextSha256":"bbb424d9d9948d12b252b1dfe4ee5f6e259cbf4f7946185037dcdc88c3291e3d","contextType":"FunctionDeclaration","contextName":"createProductionSearchAdHierarchyRuntime","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Inventory-only transport wrapper: exact origin, credential-free URL, redirects denied; upstream read-only gateway classification remains required.","testRefs":["test/postgres-searchad-inventory-http.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/runtime-production.js","kind":"network_capability_transfer","nodeSha256":"094a2723c09b0bbfcc646041e2deb9da69e28497fea5a93581e6d88a5e58456b","contextSha256":"bbb424d9d9948d12b252b1dfe4ee5f6e259cbf4f7946185037dcdc88c3291e3d","contextType":"FunctionDeclaration","contextName":"createProductionSearchAdHierarchyRuntime","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Inventory-only transport wrapper: exact origin, credential-free URL, redirects denied; upstream read-only gateway classification remains required.","testRefs":["test/postgres-searchad-inventory-http.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/runtime-production.js","kind":"network_initiation","nodeSha256":"a97245dfab6b23870c6e67abfda85b20e0deb8b936dd3fa3d6bbe7abd6a7c020","contextSha256":"bbb424d9d9948d12b252b1dfe4ee5f6e259cbf4f7946185037dcdc88c3291e3d","contextType":"FunctionDeclaration","contextName":"createProductionSearchAdHierarchyRuntime","occurrences":1,"reason":"Inventory-only transport wrapper: exact origin, credential-free URL, redirects denied; upstream read-only gateway classification remains required.","testRefs":["test/postgres-searchad-inventory-http.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/lifecycle/sibling-create-service.js","kind":"network_capability_transfer","nodeSha256":"38b5af85cb4a5be6452433eb275d60de1bb5a3cc915b598469280b2de0a4f48d","contextSha256":"2d8e06e629b4c212fe55b6eb9f3c1bdbc59baa21ca6b6808f58021ddc4dff529","contextType":"MethodDefinition","contextName":"SiblingCreateService.constructor","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Existing sibling constructor injects transport into the authentic account send fence.","testRefs":["test/postgres-searchad-sibling-create.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/reporting/runtime.js","kind":"network_capability_transfer","nodeSha256":"9c9073a9f78a54263ad0a5f098fb399ce3cae9e569f95bf7a81cc5dcfc1b2a04","contextSha256":"9ad5e289e190f5bc8f94e9592b09b68e1b3b780ba56e600b752e490a8299e489","contextType":"FunctionDeclaration","contextName":"createReportingRuntime","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Reporting runtime injects existing transport into the fixed-origin, no-retry report client.","testRefs":["test/searchad-reporting-runtime.test.js","test/postgres-searchad-report-jobs.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/reporting/s3-storage.js","kind":"network_import","nodeSha256":"e4f376747ec2b6b536e72a8de5b5c53b421483dab91850a57aa91d62ade1533c","contextSha256":"8a73f46eed74e989327c6f592bff18f69c9bf2df055ca375d78a094161805d2e","contextType":"ImportDeclaration","contextName":"ImportDeclaration","occurrences":1,"reason":"Exact report archive SDK import and put/get delegations; scoped object key/checksum and configured durable storage only.","testRefs":["test/searchad-reporting-ingestion.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/reporting/s3-storage.js","kind":"raw_client_delegation","nodeSha256":"73a347c690c12c79bc0424c85d4dd65d6299dc9c5c0ede5689d7e697ed1cc90d","contextSha256":"f429739eab25ea0b6f3ac33a869c7990e074b984e4ed6e5476f0c80229e47e84","contextType":"MethodDefinition","contextName":"S3CompatibleReportStorage.put","occurrences":1,"reason":"Exact report archive SDK import and put/get delegations; scoped object key/checksum and configured durable storage only.","testRefs":["test/searchad-reporting-ingestion.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/reporting/s3-storage.js","kind":"raw_client_delegation","nodeSha256":"5adb1daa8ea54d0f98bf1be1352f00694b33cd9a45c55141cefa0d653de40611","contextSha256":"84a0b99ea67fefb4b14f7834158985234e47f875f0ed531344e83197ecee58c7","contextType":"MethodDefinition","contextName":"S3CompatibleReportStorage.get","occurrences":1,"reason":"Exact report archive SDK import and put/get delegations; scoped object key/checksum and configured durable storage only.","testRefs":["test/searchad-reporting-ingestion.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/spec-sync.js","kind":"network_initiation","nodeSha256":"fcca233c03a9154ff615c0519768f0e9e5b4da96053a1310eb9665d5360e95d8","contextSha256":"dde66e7f4d1649ed11f52e32a197067441de87b3357711ecbb5936f51355e338","contextType":"FunctionDeclaration","contextName":"fetchSource","occurrences":1,"reason":"Offline maintenance command fetchSource: pinned source size/git-blob hashes verified; never ad execution authority.","testRefs":["test/searchad-spec.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/spec-sync.js","kind":"network_capability_transfer","nodeSha256":"366efb90aee50a1f2ad353b81a2fd0a46393f436220de1f6d25dc6e79d7e6e23","contextSha256":"409028cd0e99552db8033c33347525ee2bf2d013871bae524ea3c14b557d1c5c","contextType":"FunctionDeclaration","contextName":"syncPinnedSearchAdSpec","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Offline maintenance command fetchSource: pinned source size/git-blob hashes verified; never ad execution authority.","testRefs":["test/searchad-spec.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/transport/report-download.js","kind":"raw_client_delegation","nodeSha256":"b65f18a4e509f041e23b7594605c284ae7dee584a6dd8d9fe97bc6c5129327ee","contextSha256":"737e50e6a548baa6366fc5c370fc31908122033979c6eb638790f14dc9fe0d24","contextType":"MethodDefinition","contextName":"ReportDownloadTransport.download","occurrences":1,"reason":"Separate owned-job signed-download delegation: fixed path/origin/query, no redirects or retries, byte bound. Not a 127th operation.","testRefs":["test/searchad-reporting-ingestion.test.js","test/postgres-searchad-report-ingestion.integration.test.js"]}),
  Object.freeze({"file":"src/naver/searchad/write/runtime-production.js","kind":"network_capability_transfer","nodeSha256":"6d674c4a663c137912a8d6dd1f29459be8ee23351f72a981955380fc82efff3b","contextSha256":"e739f8a21ada21611a2b8babc1e87868e31bd7d2e3f4c84c630108d985e88e4e","contextType":"FunctionDeclaration","contextName":"createProductionSearchAdWriteRuntime","occurrences":1,"reason":"Exact reviewed transport injection/capability transfer; Ordinary writer composes its no-retry read client from the existing gateway transport.","testRefs":["test/postgres-searchad-write-runtime.integration.test.js"]}),
]);
// These records describe existing data-only escape sites, never callable
// transport approval. Each candidate-only escape remains context/count pinned.
export const REVIEWED_REQUEST_DATA_ESCAPES = Object.freeze([
  Object.freeze({"file":"src/catalog/channel-import/import-service.js","kind":"network_capability_transfer","nodeSha256":"f1da99806bef5d5afa2ec80ab05e598c4c759417bba986efc3301de9234bc75b","contextSha256":"6684adcb997b3861cd6e77e4441a5278248cdf559b9746a227da16f3bf2a73b7","contextType":"FunctionDeclaration","contextName":"requestFingerprint","occurrences":1,"producer":"ChannelImportService.run request options -> requestFingerprint/sha256Json or repository.createImportRun; source: src/catalog/channel-import/import-service.js and canonical-json.js","shape":"JSON import options with channelId/mode/request; fingerprint or persistence data only, never invoked","testRefs":["test/channel-import-service.test.js","test/channel-import-repository.test.js"]}),
  Object.freeze({"file":"src/catalog/channel-import/import-service.js","kind":"network_capability_transfer","nodeSha256":"61b55f975c3a871093293c61a98a5be7a96a5d5ec98bba4ecb31b9eee7c93350","contextSha256":"b32a994025c1ed8e2ef021a47729a5688583d73be0dfffcf378429ee29dc39a0","contextType":"MethodDefinition","contextName":"ChannelImportService.run","occurrences":1,"producer":"ChannelImportService.run request options -> requestFingerprint/sha256Json or repository.createImportRun; source: src/catalog/channel-import/import-service.js and canonical-json.js","shape":"JSON import options with channelId/mode/request; fingerprint or persistence data only, never invoked","testRefs":["test/channel-import-service.test.js","test/channel-import-repository.test.js"]}),
  Object.freeze({"file":"src/catalog/channel-import/import-service.js","kind":"network_capability_transfer","nodeSha256":"602e68376268bd2e28e4387e8e1e95bd5cd1452fe8298e2de5ca165f831c8814","contextSha256":"b32a994025c1ed8e2ef021a47729a5688583d73be0dfffcf378429ee29dc39a0","contextType":"MethodDefinition","contextName":"ChannelImportService.run","occurrences":1,"producer":"ChannelImportService.run request options -> requestFingerprint/sha256Json or repository.createImportRun; source: src/catalog/channel-import/import-service.js and canonical-json.js","shape":"JSON import options with channelId/mode/request; fingerprint or persistence data only, never invoked","testRefs":["test/channel-import-service.test.js","test/channel-import-repository.test.js"]}),
  Object.freeze({"file":"src/catalog/channel-import/sqlite-repository.js","kind":"network_capability_transfer","nodeSha256":"290f53b42001728efd385e54d565f6078bee0f87007f9cddbb33e7ce78de2696","contextSha256":"67b0d7eea69c940a58f161fc04c194d9fc8dab6788ea8720a4dd9485deded312","contextType":"MethodDefinition","contextName":"SqliteChannelImportRepository.createImportRun","occurrences":1,"producer":"ChannelImportService.run -> SqliteChannelImportRepository.createImportRun(input) -> sha256Json; src/catalog/channel-import/import-service.js:125 and canonical-json.js","shape":"input.channelId/mode/request JSON options hashed as import fingerprint; not a client method","testRefs":["test/channel-import-repository.test.js","test/channel-import-service.test.js"]}),
  Object.freeze({"file":"src/http/errors-v04.js","kind":"network_capability_transfer","nodeSha256":"c7153c143911126d933847bf11b20eb4decc0d7a27d1a78224ae0b3d4be7e528","contextSha256":"910d368ffa2dfd88ace98a809d0c6b285aee7583877d528d89426d647b52ee74","contextType":"FunctionDeclaration","contextName":"toHttpErrorV04","occurrences":1,"producer":"NaverCommerceClient.requestDetailed creates unknown.request={method:currentMethod,url:currentUrl.toString()} at src/naver/client.js:108","shape":"error detail record {outcome:\"unknown\",request:{method,url}} passed to HttpError; no request invocation","testRefs":["test/naver-client.test.js","test/ledger-operations.test.js"]}),
  Object.freeze({"file":"src/http/routes-commerce.js","kind":"network_capability_transfer","nodeSha256":"ef78d2d8010ed7552307ad8536be820c48ac6e233ccc236cabe25298ccddc8a5","contextSha256":"ebfe7502f5ac521c735bd4fa7ac0ec5611a59585b32e73396c4b5c37499ec31d","contextType":"FunctionDeclaration","contextName":"createCommerceRoutes","occurrences":3,"producer":"CommerceOperationGateway.preview builds request record (src/naver/commerce/gateway.js:208); detail update/rollback routes build operationRequest from parsed JSON body (src/http/routes-commerce.js:210,245)","shape":"operationId/resourceKey/redacted request or channelProductNo/detailContent/backupId records; idempotency comparison or async ledger metadata; task callback is a separate field","testRefs":["test/commerce-http-api.test.js","test/commerce-gateway.test.js","test/ledger-operations.test.js"]}),
  Object.freeze({"file":"src/http/routes-commerce.js","kind":"network_capability_transfer","nodeSha256":"e2f1a811142c7914efb6f2f7531d9f23aa9165678ec31ce4f4e8db8a71a7ca00","contextSha256":"ebfe7502f5ac521c735bd4fa7ac0ec5611a59585b32e73396c4b5c37499ec31d","contextType":"FunctionDeclaration","contextName":"createCommerceRoutes","occurrences":1,"producer":"CommerceOperationGateway.preview builds request record (src/naver/commerce/gateway.js:208); detail update/rollback routes build operationRequest from parsed JSON body (src/http/routes-commerce.js:210,245)","shape":"operationId/resourceKey/redacted request or channelProductNo/detailContent/backupId records; idempotency comparison or async ledger metadata; task callback is a separate field","testRefs":["test/commerce-http-api.test.js","test/commerce-gateway.test.js","test/ledger-operations.test.js"]}),
  Object.freeze({"file":"src/http/routes-commerce.js","kind":"network_capability_transfer","nodeSha256":"6ba322320c439884baf3f9979ffee20973bf12393fb695d773179b32444aa358","contextSha256":"ebfe7502f5ac521c735bd4fa7ac0ec5611a59585b32e73396c4b5c37499ec31d","contextType":"FunctionDeclaration","contextName":"createCommerceRoutes","occurrences":1,"producer":"CommerceOperationGateway.preview builds request record (src/naver/commerce/gateway.js:208); detail update/rollback routes build operationRequest from parsed JSON body (src/http/routes-commerce.js:210,245)","shape":"operationId/resourceKey/redacted request or channelProductNo/detailContent/backupId records; idempotency comparison or async ledger metadata; task callback is a separate field","testRefs":["test/commerce-http-api.test.js","test/commerce-gateway.test.js","test/ledger-operations.test.js"]}),
  Object.freeze({"file":"src/http/routes-commerce.js","kind":"network_capability_transfer","nodeSha256":"249aac46214bf91c6b7aff520fa437a26dc11e8a8c86c3ef98665e647aea85e9","contextSha256":"ebfe7502f5ac521c735bd4fa7ac0ec5611a59585b32e73396c4b5c37499ec31d","contextType":"FunctionDeclaration","contextName":"createCommerceRoutes","occurrences":1,"producer":"CommerceOperationGateway.preview builds request record (src/naver/commerce/gateway.js:208); detail update/rollback routes build operationRequest from parsed JSON body (src/http/routes-commerce.js:210,245)","shape":"operationId/resourceKey/redacted request or channelProductNo/detailContent/backupId records; idempotency comparison or async ledger metadata; task callback is a separate field","testRefs":["test/commerce-http-api.test.js","test/commerce-gateway.test.js","test/ledger-operations.test.js"]}),
  Object.freeze({"file":"src/http/routes-drive.js","kind":"network_capability_transfer","nodeSha256":"d0a8d96cabe6be0b0101df6935636f729069d44f4bfd32166787c1171247ab6d","contextSha256":"f17222892f0fbae5c35cbeb17bfe7b43707fb4283a67b0c7a8243fe43d819b94","contextType":"FunctionDeclaration","contextName":"createDriveRoutes","occurrences":1,"producer":"createDriveRoutes constructs request metadata from parsed route body; upload uses inlineContentRequest+parentId at line348, permission uses fileId/type/role/recipientSha256 flags at line483; enqueueDriveMutation forwards only metadata to idempotency/ledger","shape":"Drive route request record; idempotency comparison/persistence distinct from separately provided task callback","testRefs":["test/http-drive-api.test.js","test/ledger-operations.test.js"]}),
  Object.freeze({"file":"src/http/routes-drive.js","kind":"network_capability_transfer","nodeSha256":"705bbbc8a70a6a12528c50e062c25485c3acb971943adcad7b16d580c3c6ef2f","contextSha256":"f17222892f0fbae5c35cbeb17bfe7b43707fb4283a67b0c7a8243fe43d819b94","contextType":"FunctionDeclaration","contextName":"createDriveRoutes","occurrences":1,"producer":"createDriveRoutes constructs request metadata from parsed route body; upload uses inlineContentRequest+parentId at line348, permission uses fileId/type/role/recipientSha256 flags at line483; enqueueDriveMutation forwards only metadata to idempotency/ledger","shape":"Drive route request record; idempotency comparison/persistence distinct from separately provided task callback","testRefs":["test/http-drive-api.test.js","test/ledger-operations.test.js"]}),
  Object.freeze({"file":"src/http/routes-drive.js","kind":"network_capability_transfer","nodeSha256":"6a3000cbe7f56269f97dd97b0224cbe8a74610b87b35c3f2e2baae03f095a5cb","contextSha256":"f17222892f0fbae5c35cbeb17bfe7b43707fb4283a67b0c7a8243fe43d819b94","contextType":"FunctionDeclaration","contextName":"createDriveRoutes","occurrences":1,"producer":"createDriveRoutes constructs request metadata from parsed route body; upload uses inlineContentRequest+parentId at line348, permission uses fileId/type/role/recipientSha256 flags at line483; enqueueDriveMutation forwards only metadata to idempotency/ledger","shape":"Drive route request record; idempotency comparison/persistence distinct from separately provided task callback","testRefs":["test/http-drive-api.test.js","test/ledger-operations.test.js"]}),
  Object.freeze({"file":"src/http/routes-drive.js","kind":"network_capability_transfer","nodeSha256":"64be905c5f1e26d837e71f70ec0e9b6a3cb86b4d9a2448be8f47e334b184771b","contextSha256":"f17222892f0fbae5c35cbeb17bfe7b43707fb4283a67b0c7a8243fe43d819b94","contextType":"FunctionDeclaration","contextName":"createDriveRoutes","occurrences":1,"producer":"createDriveRoutes constructs request metadata from parsed route body; upload uses inlineContentRequest+parentId at line348, permission uses fileId/type/role/recipientSha256 flags at line483; enqueueDriveMutation forwards only metadata to idempotency/ledger","shape":"Drive route request record; idempotency comparison/persistence distinct from separately provided task callback","testRefs":["test/http-drive-api.test.js","test/ledger-operations.test.js"]}),
  Object.freeze({"file":"src/http/runtime.js","kind":"network_capability_transfer","nodeSha256":"1846d23744e29d6db4278fbcf92e6b8feb58271bb58498b9ab86b6e6dc04ccfb","contextSha256":"b51f1216f374dfac741dd9d26f8977742434b813a5d552412bd7def7a1d158d7","contextType":"FunctionDeclaration","contextName":"ensureSameIdempotentOperation","occurrences":1,"producer":"HTTP routes and createAsyncOperation pass metadata into ensureSameIdempotentOperation; existing.request_json is JSON.parse output in src/http/runtime.js:148","shape":"JSON serialization comparison of persisted request metadata; request is not invoked","testRefs":["test/ledger-operations.test.js","test/commerce-http-api.test.js"]}),
  Object.freeze({"file":"src/http/server-v03.js","kind":"network_capability_transfer","nodeSha256":"d0a8d96cabe6be0b0101df6935636f729069d44f4bfd32166787c1171247ab6d","contextSha256":"5c0e4f453bf93f9b5acb3ba41fbeb8151089956b81887eba17c2c82abc066049","contextType":"FunctionDeclaration","contextName":"createHttpApiV03","occurrences":1,"producer":"HTTP route composition passes server-built request metadata to createAsyncOperation; src/http/routes-commerce.js and src/http/routes-drive.js; Ledger.createOperation serializes it in src/infrastructure/ledger.js:113","shape":"operationType/sourceProductId/request metadata, compared for idempotency or serialized into ledger; executable task is kept separate","testRefs":["test/ledger-operations.test.js","test/commerce-http-api.test.js","test/http-drive-api.test.js"]}),
  Object.freeze({"file":"src/http/server-v03.js","kind":"network_capability_transfer","nodeSha256":"947583f350974b2b10f0f42aa8bcd8306374b5313a53daa53565f95a00ea51c6","contextSha256":"5c0e4f453bf93f9b5acb3ba41fbeb8151089956b81887eba17c2c82abc066049","contextType":"FunctionDeclaration","contextName":"createHttpApiV03","occurrences":1,"producer":"HTTP route composition passes server-built request metadata to createAsyncOperation; src/http/routes-commerce.js and src/http/routes-drive.js; Ledger.createOperation serializes it in src/infrastructure/ledger.js:113","shape":"operationType/sourceProductId/request metadata, compared for idempotency or serialized into ledger; executable task is kept separate","testRefs":["test/ledger-operations.test.js","test/commerce-http-api.test.js","test/http-drive-api.test.js"]}),
  Object.freeze({"file":"src/http/server-v03.js","kind":"network_capability_transfer","nodeSha256":"32d4500110806ca2664ab19bdf1cbe62dfe9f92d07fda873f7e73277e3475800","contextSha256":"5c0e4f453bf93f9b5acb3ba41fbeb8151089956b81887eba17c2c82abc066049","contextType":"FunctionDeclaration","contextName":"createHttpApiV03","occurrences":1,"producer":"HTTP route composition passes server-built request metadata to createAsyncOperation; src/http/routes-commerce.js and src/http/routes-drive.js; Ledger.createOperation serializes it in src/infrastructure/ledger.js:113","shape":"operationType/sourceProductId/request metadata, compared for idempotency or serialized into ledger; executable task is kept separate","testRefs":["test/ledger-operations.test.js","test/commerce-http-api.test.js","test/http-drive-api.test.js"]}),
  Object.freeze({"file":"src/http/server-v04.js","kind":"network_capability_transfer","nodeSha256":"d0a8d96cabe6be0b0101df6935636f729069d44f4bfd32166787c1171247ab6d","contextSha256":"14039973dd3a4d714f831eec808d2014b907efe0c493667ca1330c13385848cd","contextType":"FunctionDeclaration","contextName":"createHttpApiV04","occurrences":1,"producer":"HTTP route composition passes server-built request metadata to createAsyncOperation; src/http/routes-commerce.js and src/http/routes-drive.js; Ledger.createOperation serializes it in src/infrastructure/ledger.js:113","shape":"operationType/sourceProductId/request metadata, compared for idempotency or serialized into ledger; executable task is kept separate","testRefs":["test/ledger-operations.test.js","test/commerce-http-api.test.js","test/http-drive-api.test.js"]}),
  Object.freeze({"file":"src/http/server-v04.js","kind":"network_capability_transfer","nodeSha256":"947583f350974b2b10f0f42aa8bcd8306374b5313a53daa53565f95a00ea51c6","contextSha256":"14039973dd3a4d714f831eec808d2014b907efe0c493667ca1330c13385848cd","contextType":"FunctionDeclaration","contextName":"createHttpApiV04","occurrences":1,"producer":"HTTP route composition passes server-built request metadata to createAsyncOperation; src/http/routes-commerce.js and src/http/routes-drive.js; Ledger.createOperation serializes it in src/infrastructure/ledger.js:113","shape":"operationType/sourceProductId/request metadata, compared for idempotency or serialized into ledger; executable task is kept separate","testRefs":["test/ledger-operations.test.js","test/commerce-http-api.test.js","test/http-drive-api.test.js"]}),
  Object.freeze({"file":"src/http/server-v04.js","kind":"network_capability_transfer","nodeSha256":"32d4500110806ca2664ab19bdf1cbe62dfe9f92d07fda873f7e73277e3475800","contextSha256":"14039973dd3a4d714f831eec808d2014b907efe0c493667ca1330c13385848cd","contextType":"FunctionDeclaration","contextName":"createHttpApiV04","occurrences":1,"producer":"HTTP route composition passes server-built request metadata to createAsyncOperation; src/http/routes-commerce.js and src/http/routes-drive.js; Ledger.createOperation serializes it in src/infrastructure/ledger.js:113","shape":"operationType/sourceProductId/request metadata, compared for idempotency or serialized into ledger; executable task is kept separate","testRefs":["test/ledger-operations.test.js","test/commerce-http-api.test.js","test/http-drive-api.test.js"]}),
  Object.freeze({"file":"src/http/server-v05.js","kind":"network_capability_transfer","nodeSha256":"479ef64ba8f5f8df619f5391cfc5f35dd170cfbec71bfb67464492b979a268ca","contextSha256":"9aada6ae2015fa90f0d25fc83aeddaf9e48abe14a1719536d83c50b1a60c8aeb","contextType":"FunctionDeclaration","contextName":"createHttpApiV05","occurrences":1,"producer":"HTTP route composition passes server-built request metadata to createAsyncOperation; src/http/routes-commerce.js and src/http/routes-drive.js; Ledger.createOperation serializes it in src/infrastructure/ledger.js:113","shape":"operationType/sourceProductId/request metadata, compared for idempotency or serialized into ledger; executable task is kept separate. Task8 adds exact role-scoped product routes and Task11 changes safe HTTP log fields in this enclosing composition only; the reviewed data node and createAsyncOperation remain unchanged.","testRefs":["test/ledger-operations.test.js","test/commerce-http-api.test.js","test/http-drive-api.test.js","test/postgres-searchad-product-evidence.integration.test.js"]}),
  Object.freeze({"file":"src/http/server.js","kind":"network_capability_transfer","nodeSha256":"d0a8d96cabe6be0b0101df6935636f729069d44f4bfd32166787c1171247ab6d","contextSha256":"5222c633d9a1681c7816f16f482161c4c84fa717010a7354b5f9925b17c84a3c","contextType":"FunctionDeclaration","contextName":"createHttpApi","occurrences":1,"producer":"HTTP route composition passes server-built request metadata to createAsyncOperation; src/http/routes-commerce.js and src/http/routes-drive.js; Ledger.createOperation serializes it in src/infrastructure/ledger.js:113","shape":"operationType/sourceProductId/request metadata, compared for idempotency or serialized into ledger; executable task is kept separate","testRefs":["test/ledger-operations.test.js","test/commerce-http-api.test.js","test/http-drive-api.test.js"]}),
  Object.freeze({"file":"src/http/server.js","kind":"network_capability_transfer","nodeSha256":"947583f350974b2b10f0f42aa8bcd8306374b5313a53daa53565f95a00ea51c6","contextSha256":"5222c633d9a1681c7816f16f482161c4c84fa717010a7354b5f9925b17c84a3c","contextType":"FunctionDeclaration","contextName":"createHttpApi","occurrences":1,"producer":"HTTP route composition passes server-built request metadata to createAsyncOperation; src/http/routes-commerce.js and src/http/routes-drive.js; Ledger.createOperation serializes it in src/infrastructure/ledger.js:113","shape":"operationType/sourceProductId/request metadata, compared for idempotency or serialized into ledger; executable task is kept separate","testRefs":["test/ledger-operations.test.js","test/commerce-http-api.test.js","test/http-drive-api.test.js"]}),
  Object.freeze({"file":"src/http/server.js","kind":"network_capability_transfer","nodeSha256":"32d4500110806ca2664ab19bdf1cbe62dfe9f92d07fda873f7e73277e3475800","contextSha256":"5222c633d9a1681c7816f16f482161c4c84fa717010a7354b5f9925b17c84a3c","contextType":"FunctionDeclaration","contextName":"createHttpApi","occurrences":1,"producer":"HTTP route composition passes server-built request metadata to createAsyncOperation; src/http/routes-commerce.js and src/http/routes-drive.js; Ledger.createOperation serializes it in src/infrastructure/ledger.js:113","shape":"operationType/sourceProductId/request metadata, compared for idempotency or serialized into ledger; executable task is kept separate","testRefs":["test/ledger-operations.test.js","test/commerce-http-api.test.js","test/http-drive-api.test.js"]}),
  Object.freeze({"file":"src/infrastructure/ledger.js","kind":"network_capability_transfer","nodeSha256":"7b93b1579398f1040d57496e567115bc5e9f181f4cf332a6791f677b95a0eaf8","contextSha256":"3764a805d2648cee08997053e50f4100ae4130682087d54d2db608248efddba1","contextType":"MethodDefinition","contextName":"Ledger.createOperation","occurrences":1,"producer":"HTTP createAsyncOperation -> Ledger.createOperation({request}); its stringify helper uses JSON serialization in src/infrastructure/ledger.js","shape":"request JSON persisted to request_json with SQL placeholders; stringify does not invoke request as a callable","testRefs":["test/ledger-operations.test.js"]}),
  Object.freeze({"file":"src/naver/commerce/gateway.js","kind":"network_capability_return","nodeSha256":"882101dd8697a52e0480af0873d4640b6bb8b487665fdc6013a1e87120badb76","contextSha256":"de3bf3e6e719e012b944d158e090ad3ddb1532a146440d05fdc5dad8ccf69560","contextType":"MethodDefinition","contextName":"CommerceOperationGateway.execute","occurrences":1,"producer":"CommerceOperationGateway.preview constructs redacted request from operationId/method/apiPath/query/body/transport/fingerprint at src/naver/commerce/gateway.js:208-219","shape":"execute returns operation/request/resourceKey/upstream/data response record; preview.request is metadata, not the raw transport","testRefs":["test/commerce-gateway.test.js","test/commerce-http-api.test.js"]}),
]);
const networkModule = /^(?:(?:node:)?(?:https?|http2|net|tls)$|(?:undici|axios|node-fetch|cross-fetch|got|superagent|ws|websocket|@aws-sdk\/client-s3)(?:\/|$))/;
const extensions = new Set(['.js', '.mjs', '.cjs']);
const digest = value => createHash('sha256').update(value).digest('hex');
function walk(node, visit, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, ancestors);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit, [...ancestors,node]);
    else if (value && typeof value === 'object') walk(value, visit, [...ancestors,node]);
  }
}
function sourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file=path.join(directory,entry.name);
    if(entry.isSymbolicLink()) throw new Error(`SEARCHAD_SCAN_SYMLINK_UNREVIEWED:${file}`);
    return entry.isDirectory() ? sourceFiles(file) : extensions.has(path.extname(file)) ? [file] : [];
  });
}
const REVIEWED_FENCE_EXPORT = Object.freeze({
  file: 'src/naver/searchad/lifecycle/postgres-account-send-fence.js',
  exportName: 'PostgresAccountSendFence',
  moduleSha256: '82652c1262dccf55dcd6764b4bbc4740f84e28a7210142ec3142e62166fd5785'
});
// Module integrity is required only to establish the imported constructor's
// provenance. It never exempts this module or any of its calls from scanning.
function trustedFenceDelegation({root,file,nodes,key,property}) {
  const definitions=new Map(), writes=new Set();
  const add=(name,definition)=>{if(name)definitions.set(name,[...(definitions.get(name)||[]),definition]);};
  function declare(pattern,definition){
    if(!pattern)return;
    if(pattern.type==='Identifier')add(pattern.name,definition);
    else if(pattern.type==='AssignmentPattern')declare(pattern.left,definition);
    else if(pattern.type==='RestElement')declare(pattern.argument,definition);
    else if(pattern.type==='ObjectPattern')for(const item of pattern.properties)declare(item.value||item.argument,definition);
    else if(pattern.type==='ArrayPattern')for(const item of pattern.elements)declare(item,definition);
  }
  function markWrite(target){
    if(!target)return;
    if(target.type==='Identifier'||target.type==='MemberExpression')writes.add(key(target));
    else if(target.type==='AssignmentPattern')markWrite(target.left);
    else if(target.type==='RestElement')markWrite(target.argument);
    else if(target.type==='ObjectPattern')for(const field of target.properties)markWrite(field.value||field.argument);
    else if(target.type==='ArrayPattern')for(const item of target.elements)markWrite(item);
  }
  for(const node of nodes){
    if(node.type==='ImportDeclaration')for(const spec of node.specifiers)add(spec.local.name,{kind:'import',source:node.source.value,imported:spec.imported?.name,namespace:spec.type==='ImportNamespaceSpecifier'});
    if(node.type==='VariableDeclarator')declare(node.id,node.id.type==='Identifier'?{kind:'variable',init:node.init}:{kind:'local'});
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){
      if(node.id)declare(node.id,{kind:'local'});
      for(const param of node.params)declare(param,{kind:'local'});
    }
    if(['ClassDeclaration','ClassExpression'].includes(node.type)&&node.id)declare(node.id,{kind:'local'});
    if(node.type==='CatchClause')declare(node.param,{kind:'local'});
    if(node.type==='AssignmentExpression'||node.type==='UpdateExpression')markWrite(node.left||node.argument);
    if(node.type==='ForOfStatement'||node.type==='ForInStatement')markWrite(node.left);
  }
  const definition=name=>!writes.has(name)&&definitions.get(name)?.length===1 ? definitions.get(name)[0] : null;
  let pristine=false;
  try {
    const absolute=path.join(root,REVIEWED_FENCE_EXPORT.file);
    pristine=fs.realpathSync(absolute)===absolute && digest(fs.readFileSync(absolute))===REVIEWED_FENCE_EXPORT.moduleSha256;
  } catch { /* An absent or changed export is never trusted. */ }
  const importedFromFence=entry=>pristine && entry?.kind==='import' && entry.source.startsWith('.') && path.resolve(root,path.dirname(file),entry.source)===path.join(root,REVIEWED_FENCE_EXPORT.file);
  function constructor(node,seen=new Set()){
    if(!node||seen.has(node))return false;seen.add(node);
    if(node.type==='Identifier'){
      const entry=definition(node.name);
      return importedFromFence(entry) && entry.imported===REVIEWED_FENCE_EXPORT.exportName || entry?.kind==='variable' && constructor(entry.init,seen);
    }
    if(node.type==='MemberExpression'&&property(node)===REVIEWED_FENCE_EXPORT.exportName&&node.object.type==='Identifier'){
      const entry=definition(node.object.name);return importedFromFence(entry)&&entry.namespace;
    }
    return false;
  }
  // An ambiguous/shadowed/reassigned binding is rejected conservatively. This
  // does not infer trust from a class/variable spelling or a neighboring scope.
  const methodTampered=[...writes].some(target=>target?.endsWith('.fetch'));
  function instance(node,seen=new Set()){
    if(!node||methodTampered||seen.has(node))return false;seen.add(node);
    if(node.type==='NewExpression')return constructor(node.callee);
    if(node.type==='Identifier'){const entry=definition(node.name);return entry?.kind==='variable' && instance(entry.init,seen);}
    if(node.type==='MemberExpression'&&node.object.type==='ThisExpression'){
      const assignments=nodes.filter(item=>item.type==='AssignmentExpression'&&key(item.left)===key(node));
      return assignments.length===1 && instance(assignments[0].right,seen);
    }
    return false;
  }
  return instance;
}
function inspect(source, ast, {root,file}) {
  const nodes=[],parents=new WeakMap();walk(ast,(node,ancestors)=>{nodes.push(node);parents.set(node,ancestors);});
  const bindings=new Map(), constants=new Map(), imports=[], findings=[];
  const key=node=>node?.type==='Identifier' ? node.name : node?.type==='PrivateIdentifier' ? `#${node.name}` : node?.type==='ThisExpression' ? 'this' : node?.type==='MemberExpression' ? `${key(node.object)}.${property(node)}` : null;
  const literal=node=>node?.type==='Literal' ? node.value : node?.type==='Identifier' ? constants.get(node.name) : node?.type==='BinaryExpression' && node.operator==='+' ? (typeof literal(node.left)==='string' && typeof literal(node.right)==='string' ? literal(node.left)+literal(node.right) : undefined) : node?.type==='TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : undefined;
  const property=node=>node.computed ? literal(node.property) : node.property?.type==='PrivateIdentifier' ? `#${node.property.name}` : node.property?.name;
  const isFenceInstance=trustedFenceDelegation({root,file,nodes,key,property});
  const networkKinds=new Set(['global','network','network_module','raw_client','network_container']);
  const candidateKinds=new Set(['request_candidate','request_container']);
  const capabilityKinds=new Set([...networkKinds,...candidateKinds]);
  const containerKind=values=>values.some(value=>networkKinds.has(value)) ? 'network_container' : values.some(value=>candidateKinds.has(value)) ? 'request_container' : null;
  // A literal-data proof is local and conservative: no getters/functions/spreads,
  // ambiguous declarations or request-member writes may establish data identity.
  const mutationTargets=nodes.flatMap(node=>node.type==='AssignmentExpression'?[node.left]:node.type==='UpdateExpression'||node.type==='UnaryExpression'&&node.operator==='delete'?[node.argument]:[]);
  const memberWritten=mutationTargets.some(target=>{let member=false;walk(target,node=>{if(node.type==='MemberExpression')member=true;});return member;});
  const declaredNames=new Map();
  function noteDeclaration(pattern){
    if(!pattern)return;
    if(pattern.type==='Identifier')declaredNames.set(pattern.name,(declaredNames.get(pattern.name)||0)+1);
    else if(pattern.type==='AssignmentPattern')noteDeclaration(pattern.left);
    else if(pattern.type==='RestElement')noteDeclaration(pattern.argument);
    else if(pattern.type==='ObjectPattern')for(const field of pattern.properties)noteDeclaration(field.value||field.argument);
    else if(pattern.type==='ArrayPattern')for(const field of pattern.elements)noteDeclaration(field);
  }
  for(const node of nodes){
    if(node.type==='VariableDeclarator')noteDeclaration(node.id);
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){noteDeclaration(node.id);for(const param of node.params)noteDeclaration(param);}
    if(['ClassDeclaration','ClassExpression'].includes(node.type))noteDeclaration(node.id);
    if(node.type==='ImportDeclaration')for(const specifier of node.specifiers)noteDeclaration(specifier.local);
    if(node.type==='CatchClause')noteDeclaration(node.param);
  }
  function literalData(node,seen=new Set()){
    if(!node||seen.has(node)||memberWritten)return false;seen.add(node);
    if(node.type==='Literal')return true;
    if(node.type==='ObjectExpression')return node.properties.every(field=>field.type==='Property'&&field.kind==='init'&&!field.method&&!field.computed&&literalData(field.value,new Set(seen)));
    if(node.type==='ArrayExpression')return node.elements.every(item=>literalData(item,new Set(seen)));
    if(node.type==='Identifier'){
      const declarations=nodes.filter(item=>item.type==='VariableDeclarator'&&item.id.type==='Identifier'&&item.id.name===node.name);
      const ambiguous=declaredNames.get(node.name)!==1||mutationTargets.some(target=>{let assigned=false;walk(target,item=>{if(item.type==='Identifier'&&item.name===node.name)assigned=true;});return assigned;});
      return !ambiguous&&declarations.length===1&&parents.get(declarations[0])?.at(-1)?.kind==='const'&&literalData(declarations[0].init,seen);
    }
    return false;
  }
  function requestIsData(owner){
    if(!literalData(owner))return false;
    if(owner.type==='Identifier')owner=nodes.find(item=>item.type==='VariableDeclarator'&&item.id.name===owner.name)?.init;
    return owner?.type==='ObjectExpression'&&owner.properties.some(field=>(field.key.name||field.key.value)==='request'&&literalData(field.value));
  }
  const plainJsonStringify=()=>!declaredNames.has('JSON')&&!mutationTargets.some(target=>{let changed=false;walk(target,node=>{if(node.type==='Identifier'&&node.name==='JSON')changed=true;});return changed;});

  const signature=node=>{
    if(!node)return null;
    if(node.type==='ChainExpression'||node.type==='AwaitExpression')return signature(node.expression||node.argument);
    const assigned=bindings.get(key(node));if(assigned)return assigned;
    if(node.type==='Identifier') {
      if(['globalThis','window','global','self'].includes(node.name))return 'global';
      if(['fetch','fetchImpl','WebSocket','XMLHttpRequest'].includes(node.name))return 'network';
    }
    if(node.type==='ObjectExpression')return containerKind(node.properties.map(field=>signature(field.value||field.argument)));
    if(node.type==='ArrayExpression')return containerKind(node.elements.map(item=>signature(item?.argument||item)));
    if(node.type==='LogicalExpression'){const values=[signature(node.left),signature(node.right)];return values.find(value=>networkKinds.has(value))||values.find(value=>candidateKinds.has(value))||null;}
    if(node.type==='ConditionalExpression'){const values=[signature(node.consequent),signature(node.alternate)];return values.find(value=>networkKinds.has(value))||values.find(value=>candidateKinds.has(value))||null;}
    if(node.type==='ImportExpression')return networkModule.test(literal(node.source)||'') ? 'network_module' : null;
    if(node.type==='CallExpression' && node.callee.type==='MemberExpression' && property(node.callee)==='bind')return signature(node.callee.object);
    if(node.type==='MemberExpression'){
      const owner=signature(node.object),name=property(node);
      if(name==='fetch' && isFenceInstance(node.object))return 'approved_delegation';
      if(owner==='global' && (name===undefined||['fetch','WebSocket','XMLHttpRequest'].includes(name)))return 'network';
      if(owner==='network_module')return name==='createServer' ? 'inbound_server' : 'network';
      if(['bind','call','apply'].includes(name))return signature(node.object);
      if(['fetch','fetchImpl','#fetch'].includes(name))return 'network';
      if(name==='request')return requestIsData(node.object) ? 'request_data' : /client|http|axios|socket/i.test(key(node.object)||'') ? 'raw_client' : 'request_candidate';
      if(name==='send' && /client|socket/i.test(key(node.object)||''))return 'raw_client';
    }
    return null;
  };
  function bind(pattern,value,owner) {
    if(!pattern)return;
    if(pattern.type==='AssignmentPattern')return bind(pattern.left,value||signature(pattern.right),owner);
    if(pattern.type==='ObjectPattern')for(const entry of pattern.properties){
      const name=entry.key?.name||entry.key?.value;
      bind(entry.value,['fetch','fetchImpl','WebSocket','XMLHttpRequest'].includes(name) ? 'network' : name==='request' ? (requestIsData(owner)?'request_data':/client|http|axios|socket/i.test(key(owner)||'')?'raw_client':'request_candidate') : value==='network_module' ? 'network' : null);
    }
    else if(value && key(pattern))bindings.set(key(pattern),value);
  }
  // Conservative fixed-point alias propagation; never assume name shadowing
  // makes a suspicious call safe. Approved gateway methods are not raw clients.
  for(let pass=0;pass<=nodes.length;pass++){
    const before=JSON.stringify([...bindings])+JSON.stringify([...constants],(_,value)=>typeof value==='bigint'?{bigint:String(value)}:value);
    for(const node of nodes){
      if(node.type==='ImportDeclaration'){
        if(networkModule.test(node.source.value))for(const spec of node.specifiers)bindings.set(spec.local.name,spec.type==='ImportNamespaceSpecifier'||spec.type==='ImportDefaultSpecifier' ? 'network_module' : spec.imported?.name==='createServer' ? 'inbound_server' : node.source.value==='@aws-sdk/client-s3' ? 'sdk_constructor' : 'network');
      }
      if(node.type==='VariableDeclarator'){
        const value=literal(node.init);if(node.id.type==='Identifier' && value!==undefined)constants.set(node.id.name,value);bind(node.id,signature(node.init),node.init);
        if(node.init?.type==='ObjectExpression' && key(node.id))for(const field of node.init.properties){const value=signature(field.value);if(value)bindings.set(`${key(node.id)}.${field.key?.name||field.key?.value}`,value);}
      }
      if(['FunctionExpression','FunctionDeclaration','ArrowFunctionExpression'].includes(node.type))for(const param of node.params)bind(param,null);
      if(node.type==='AssignmentExpression')bind(node.left,signature(node.right));
    }
    if(before===JSON.stringify([...bindings])+JSON.stringify([...constants],(_,value)=>typeof value==='bigint'?{bigint:String(value)}:value))break;
  }
  function finding(node,kind,detail,requestDataCandidate=false){
    const ancestors=parents.get(node)||[];
    const context=ancestors.find(item=>['MethodDefinition','FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(item.type)) || ancestors.findLast(item=>['VariableDeclaration','ExpressionStatement','ExportNamedDeclaration','ExportDefaultDeclaration'].includes(item.type)) || node;
    const classes=ancestors.filter(item=>['ClassDeclaration','ClassExpression'].includes(item.type)).map(item=>item.id?.name||'<anonymous>');
    const contextName=[...classes,context.key?.name||context.id?.name||context.type].join('.');
    findings.push({kind,line:node.loc.start.line,column:node.loc.start.column,nodeSha256:digest(source.slice(node.start,node.end)),contextSha256:digest(contextName+'\n'+source.slice(context.start,context.end)),contextType:context.type,contextName,detail,...(requestDataCandidate?{requestDataCandidate:true}:{})});
  }
  const containsCapability=node=>capabilityKinds.has(signature(node)) || Boolean(node?.type==='Identifier' && [...bindings].some(([name,value])=>name.startsWith(node.name+'.')&&capabilityKinds.has(value)));

  const candidateOnly=node=>candidateKinds.has(signature(node)) && !Boolean(node?.type==='Identifier'&&[...bindings].some(([name,value])=>name.startsWith(node.name+'.')&&networkKinds.has(value)));
  function inertCandidateSerialization(value){
    // Only a bare candidate or a shallow literal of ordinary fields can use
    // this generic sink. Hooks/containers/aliases require their own data record.
    if(memberWritten)return false;
    let hook=false;walk(value,node=>{
      if(node.type==='ArrayExpression'||node.type==='SpreadElement'||node.computed||node.type==='Property'&&(node.kind!=='init'||node.method||(node.key.name||node.key.value)==='toJSON'))hook=true;
    });
    if(hook)return false;
    const bare=node=>['Identifier','MemberExpression'].includes(node.type)&&signature(node)==='request_candidate';
    return bare(value)||value.type==='ObjectExpression'&&value.properties.every(field=>bare(field.value)||literalData(field.value));
  }


  for(const node of nodes){
    if(node.type==='ExportNamedDeclaration'||node.type==='ExportDefaultDeclaration'){
      const values=node.declaration?.type==='VariableDeclaration' ? node.declaration.declarations.map(item=>item.id) : node.declaration ? [node.declaration] : (node.specifiers||[]).map(item=>item.local);
      if(values.some(containsCapability))finding(node,'network_export','Exported network capability alias');
    }
    if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source){
      imports.push(node.source.value);if(networkModule.test(node.source.value))finding(node,'network_import',node.source.value);
    }
    if(node.type==='ReturnStatement'&&containsCapability(node.argument) || node.type==='ArrowFunctionExpression'&&node.body.type!=='BlockStatement'&&containsCapability(node.body))finding(node,'network_capability_return','Known or potentially callable outbound capability returned from a function',candidateOnly(node.argument||node.body));
    if(node.type==='ImportExpression'){
      const target=literal(node.source);
      if(typeof target==='string')imports.push(target);
      if(typeof target!=='string'||networkModule.test(target))finding(node,'dynamic_network_import',typeof target==='string'?target:'unresolved dynamic import');
    }
    if(node.type==='CallExpression'||node.type==='NewExpression'){
      if(key(node.callee)==='require'){
        const target=literal(node.arguments[0]);if(typeof target==='string')imports.push(target);
        if(typeof target!=='string'||networkModule.test(target))finding(node,'network_require',target||'unresolved require');
      }
      let kind=signature(node.callee);
      if(key(node.callee)==='Reflect.apply')kind=signature(node.arguments[0]);
      if(['network','network_module','raw_client','request_candidate'].includes(kind))finding(node,['raw_client','request_candidate'].includes(kind)?'raw_client_delegation':'network_initiation',key(node.callee)||node.callee.type);
      else {
        const capabilities=node.arguments.map(argument=>argument.argument||argument).filter(containsCapability);
        const onlyCandidates=capabilities.length>0&&capabilities.every(candidateOnly);
        // JSON serialization invokes toJSON hooks; candidate containers are
        // not generically safe merely because the serializer is unchanged.
        const serializesCandidate=onlyCandidates&&key(node.callee)==='JSON.stringify'&&node.arguments.length===1&&plainJsonStringify()&&inertCandidateSerialization(node.arguments[0]);
        if(capabilities.length&&!serializesCandidate)finding(node,'network_capability_transfer','Known or potentially callable outbound capability passed to a call or constructor',onlyCandidates);
      }
    }
  }
  return {imports,findings};
}

/** Recursively scans every source file (including future profitability/routes/
 * bootstraps), then follows relative imports even outside src. This is a static
 * regression check, not sandboxing or proof of live authorization. */
export function scanExecutionSources({root=process.cwd(),transportAllowlist=REVIEWED_TRANSPORT_BOUNDARIES,requestDataAllowlist=REVIEWED_REQUEST_DATA_ESCAPES}={}) {
  root=fs.realpathSync(path.resolve(root));
  const allowed=new Map();
  for(const boundary of transportAllowlist){
    if(!boundary || !/^src\/[A-Za-z0-9_./-]+\.(?:js|mjs|cjs)$/.test(boundary.file)||boundary.file.split('/').includes('..')||!['network_import','network_initiation','raw_client_delegation','network_capability_transfer'].includes(boundary.kind)||!/^[a-f0-9]{64}$/.test(boundary.nodeSha256)||!/^[a-f0-9]{64}$/.test(boundary.contextSha256)||!boundary.contextType||!boundary.contextName||!Number.isInteger(boundary.occurrences)||boundary.occurrences<1||!boundary.reason||!boundary.testRefs?.length)throw new Error('SEARCHAD_TRANSPORT_BOUNDARY_INVALID');
    const id=`${boundary.file}:${boundary.kind}:${boundary.nodeSha256}:${boundary.contextSha256}`;
    if(allowed.has(id))throw new Error('SEARCHAD_TRANSPORT_BOUNDARY_INVALID');allowed.set(id,boundary);
  }
  const dataAllowed=new Map();
  for(const entry of requestDataAllowlist){
    if(!entry||!/^src\/[A-Za-z0-9_./-]+\.(?:js|mjs|cjs)$/.test(entry.file)||entry.file.split('/').includes('..')||!['network_capability_transfer','network_capability_return'].includes(entry.kind)||!/^[a-f0-9]{64}$/.test(entry.nodeSha256)||!/^[a-f0-9]{64}$/.test(entry.contextSha256)||!entry.contextName||!entry.contextType||!entry.producer||!entry.shape||!entry.testRefs?.length||!Number.isInteger(entry.occurrences)||entry.occurrences<1)throw new Error('SEARCHAD_REQUEST_DATA_RECORD_INVALID');
    const id=`${entry.file}:${entry.kind}:${entry.nodeSha256}:${entry.contextSha256}`;
    if(dataAllowed.has(id))throw new Error('SEARCHAD_REQUEST_DATA_RECORD_INVALID');dataAllowed.set(id,entry);
  }
  const reviewedRequestDataEscapes=[];
  const queue=sourceFiles(path.join(root,'src')),seen=new Set(),violations=[],reviewedTransportBoundaries=[],counts=new Map();
  if(!queue.length)violations.push({file:'src',kind:'source_missing',detail:'No executable source files found'});
  while(queue.length){
    const absolute=queue.shift();if(seen.has(absolute))continue;seen.add(absolute);
    const file=path.relative(root,absolute).split(path.sep).join('/');
    let result;
    try{const source=fs.readFileSync(absolute,'utf8');result=inspect(source,parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true,allowHashBang:true}),{root,file});}
    catch(error){violations.push({file,kind:'parse_error',line:error.loc?.line||null,detail:'Source could not be read or parsed'});continue;}
    for(const dependency of result.imports.filter(name=>name.startsWith('.'))){
      const target=path.resolve(path.dirname(absolute),dependency);
      if(!target.startsWith(root+path.sep)){violations.push({file,kind:'import_outside_root',detail:dependency});continue;}
      const resolved=[target,...['.js','.mjs','.cjs','/index.js'].map(suffix=>target+suffix)].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
      if(!resolved){violations.push({file,kind:'unresolved_local_import',detail:dependency});continue;}
      if(extensions.has(path.extname(resolved))){if(fs.realpathSync(resolved)!==resolved)violations.push({file,kind:'import_symlink_unreviewed',detail:dependency});else queue.push(resolved);}
    }
    for(const finding of result.findings){
      const id=`${file}:${finding.kind}:${finding.nodeSha256}:${finding.contextSha256}`,boundary=allowed.get(id);
      counts.set(id,(counts.get(id)||0)+1);
      const dataRecord=finding.requestDataCandidate&&dataAllowed.get(id);
      if(dataRecord&&counts.get(id)<=dataRecord.occurrences)reviewedRequestDataEscapes.push({file,...finding,producer:dataRecord.producer,shape:dataRecord.shape,testRefs:dataRecord.testRefs});
      else if(boundary && counts.get(id)<=boundary.occurrences)reviewedTransportBoundaries.push({file,...finding,reason:boundary.reason,testRefs:boundary.testRefs});
      else violations.push({file,...finding});
    }
  }
  for(const [id,boundary]of allowed){
    if(seen.has(path.join(root,boundary.file)) && counts.get(id)!==boundary.occurrences)violations.push({file:boundary.file,kind:'reviewed_boundary_changed',detail:'Reviewed AST node/context occurrence count changed',nodeSha256:boundary.nodeSha256,contextSha256:boundary.contextSha256,contextName:boundary.contextName});
  }
  for(const [id,entry]of dataAllowed)if(seen.has(path.join(root,entry.file))&&counts.get(id)!==entry.occurrences)violations.push({file:entry.file,kind:'reviewed_request_data_changed',detail:'Reviewed data-only node/context occurrence count changed',nodeSha256:entry.nodeSha256,contextSha256:entry.contextSha256});
  return {reviewedRequestDataEscapes,scannedFiles:[...seen].map(file=>path.relative(root,file).split(path.sep).join('/')).sort(),violations,reviewedTransportBoundaries};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);if(args.length && (args.length!==2||args[0]!=='--root'))throw new Error('Usage: searchad-execution-safety.mjs [--root directory]');
  const result=scanExecutionSources({root:args[1]||process.cwd()});
  console.log(JSON.stringify({ok:result.violations.length===0,scope:'all recursive src plus relative import closure',staticCheckOnly:true,...result},null,2));
  process.exitCode=result.violations.length ? 1 : 0;
}
