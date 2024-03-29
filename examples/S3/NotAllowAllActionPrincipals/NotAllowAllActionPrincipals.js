const Util = require('util');

// We check that it meets the Bucket condition.
const NotAllowAllActionPrincipals = async (data, instances, region = {}) => {

  /*
    Primero: Revisar las politicas de los usuarios con acceso S3, Si tienen una
    Politica que permitida con todas las acciones.

    Segundo: Revisar a todos los usuarios con acceso a S3, si tiene alguna politica relacionada
    con diferentes acciones las cuales permitan una alteracion en el Bucket.

    iam.attachGroupPolicy, iam.listAttachedGroupPolicies
    iam.getUserPolicy

     GetUserPolicy , GetGroupPolicy o GetRolePolicy .
  */

  var message= "";

  const listUser = Util.promisify(instances.listUsers).bind(instances)
  const dataListUsers = await listUser({})

  const dataIAMUsers = dataListUsers?.Users ?? [];

  if (!dataIAMUsers) {
    message = `No se encontraron Usuarios en IAM o Habilite una politica que permita listarlos`
  }

  const listGroupName  = Util.promisify(instances.listGroups).bind(instances);
  const dataListGroupName = await listGroupName({})
  const arrayGroups = dataListGroupName?.Groups ?? [];

  // Los grupos de IAM, de acuerdo al documento de las Politicas, esta no debe de contener todo el acceso
  // Listamos los grupos con su ARN
  const listAttachPolity = Util.promisify(instances.listAttachedGroupPolicies).bind(instances)
  const groupPolicyDocument = Util.promisify(instances.getPolicyVersion).bind(instances)

  const arrCodePolicyGroupArn = await Promise.all(arrayGroups.map(async group => {
    const dataAttachGroup = await listAttachPolity({
      GroupName: group.GroupName
    })

    const codePolicyArn = dataAttachGroup.AttachedPolicies.map(policy => policy.PolicyArn)

    return codePolicyArn;
  }))

  const partitionResponse = asyncPartition(arrCodePolicyGroupArn.flat(), async (PolicyArn) => {
    const { VersionId } = await getDefaultPolicyVersion(instances, PolicyArn)

    // Analyze by Group Policy for Users
    const documentPolicyGroup = await groupPolicyDocument({ PolicyArn, VersionId });

    // Note: Missing User Policies.

    // Document of Group Polity
    const document = JSON.parse(decodeURIComponent(documentPolicyGroup.PolicyVersion.Document))

    if (Array.isArray(document.Statement)) {
      return document.Statement.some((statement) => {
        if (typeof statement.Action === 'string') {
          return (
            statement.Effect.toLowerCase() === 'allow' &&
            !(statement.Action === 's3:*' || statement.Action === '*'),
            statement.Resource == '*'
          );
        } else if (Array.isArray(statement.Action)) {
          return (
            statement.Effect.toLowerCase() === 'allow' &&
            statement.Action.some((action) => (
             (
                action === 's3:*' ||
                action === '*' ||
                action ==='s3:CreateJob' ||
                action ==='s3:PutReplicationConfiguration' ||
                action === 's3-object-lambda:*'
              )
            )),
            statement.Resource !== '*'
          )
        }
      })
    }

    return false
  })

  const verifyAnalyze = await partitionResponse;

  const [pass, fail] = verifyAnalyze.map((collection) => collection);
  const verifyAnalyzeStatus = (fail.length === 0) ? true : false;

 /* const lsitAttachedUsers = Util.promisify(instances.listAttachedUserPolicies).bind(instances)
  dataIAMUsers.map(async (user) => {
    const attachedUsers = await lsitAttachedUsers({
      UserName: user.UserName
    });
  })*/



  // console.log(dataListUsers?.Users)

  // const listPolicy = instances.listPolicies()
  /*
  * Listamos a los usuarios para obtener los bucket que ellos estan usando
  *
  * Despues de esos bucket obtenemos las politicas las cuales no permitiremos que
  * ellos tenga acceso a manipulacion o eliminacion del bucket
  * */

  /*
    El depósito de S3 no debería permitir todas las acciones de todos los principales

    --> Descripción

    Los cubos S3 mal configurados pueden filtrar información privada a todo Internet o permitir
    la manipulación o eliminación no autorizada de datos.
  */
  const result = {
    title: 'S3 bucket should not allow all actions from all principals',
    description: `Misconfigured S3 buckets can leak private information to the entire internet or allow 
                  unauthorized data tampering / deletion`,
    sis: 'HIPAA',
    remediation: `'In the S3 console, select the Permissions tab, and then Bucket Policy. 
                   Remove policies for s3:* actions for principals '*'. 
                   If necessary, modify the policy instead, to limit the access to specific principals.`,
    ref_remediation: 'https://docs.aws.amazon.com/AmazonS3/latest/dev/using-iam-policies.html',
    conceptOf: 'https://secure.dome9.com/v2/compliance-engine/policy/-10',
    status: verifyAnalyzeStatus,
    result: await partitionResponse,
  }

  return result
}

/**
 *
 * @param instances
 * @param polityArn
 * @returns {Promise<*>}
 */
const getDefaultPolicyVersion = async (instances, polityArn) => {
  const lsitPolicyVersion = Util.promisify(instances.listPolicyVersions).bind(instances);

  const dataPolityVersions = await lsitPolicyVersion({
    PolicyArn: polityArn
  })

  return dataPolityVersions.Versions.find((version) => version.IsDefaultVersion)
}

// Predicate Function: Example::
// https://advancedweb.hu/how-to-use-async-functions-with-array-filter-in-javascript/
/**
 * asyncPartition for return pass and fails
 * @param (Array) arr
 * @param predicate
 * @returns {Promise<*[][]>}
 */
async function asyncPartition(arr, predicate) {
  const pass = []
  const fail = []

  for (let e of arr) {
    ;(await predicate(e)) ? pass.push(e) : fail.push(e)
  }

  return [pass, fail]
}

module.exports = NotAllowAllActionPrincipals