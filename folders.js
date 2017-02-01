'use strict'
const http = require('http')
const url = require('url')
const lib = require('http-helper-functions')
const rLib = require('response-helper-functions')
const db = require('./folders-db.js')
const pLib = require('permissions-helper-functions')

var FOLDERS = '/folders/'

function verifyFolder(req, folder) {
  var user = lib.getUser(req.headers.authorization)
  var rslt = lib.setStandardCreationProperties(req, folder, user)
  if (!folder.isA == 'Folder')
    return 'invalid JSON: "isA" property not set to "Folder" ' + JSON.stringify(folder)
  return null
}

function createFolder(req, res, folder) {
  pLib.ifAllowedThen(req, res, '/', 'folders', 'create', function() {
    var err = verifyFolder(req, folder)
    if (err !== null)
      rLib.badRequest(res, err) 
    else {
      var id = rLib.uuid4()
      var selfURL = makeSelfURL(req, id)
      var permissions = folder._permissions
      if (permissions !== undefined) {
        delete folder._permissions; // interesting unusual case where ; is necessary
        (new pLib.Permissions(permissions)).resolveRelativeURLs(selfURL)
      }
      pLib.createPermissionsThen(req, res, selfURL, permissions, function(err, permissionsURL, permissions, responseHeaders){
        // Create permissions first. If we fail after creating the permissions resource but before creating the main resource, 
        // there will be a useless but harmless permissions document.
        // If we do things the other way around, a folder without matching permissions could cause problems.
        db.createFolderThen(req, res, id, selfURL, folder, function(etag) {
          folder.self = selfURL 
          addCalculatedProperties(folder)
          rLib.created(res, folder, req.headers.accept, folder.self, etag)
        })
      })
    }
  })
}

function makeSelfURL(req, key) {
  return FOLDERS + key
}

function addCalculatedProperties(folder) {
  folder._permissions = `scheme://authority/permissions?${externalSelf}`
  folder._permissionsHeirs = `scheme://authority/permissions-heirs?${externalSelf}`  
}

function getFolder(req, res, id) {
  pLib.ifAllowedThen(req, res, null, '_self', 'read', function(err, reason) {
    db.withFolderDo(req, res, id, function(folder , etag) {
      folder.self = makeSelfURL(req, id)
      addCalculatedProperties(folder)
      rLib.found(res, folder, req.headers.accept, folder.self, etag)
    })
  })
}

function deleteFolder(req, res, id) {
  pLib.ifAllowedThen(req, res, null, '_self', 'delete', function(err, reason) {
    db.deleteFolderThen(req, res, id, function (folder, etag) {
      lib.sendInternalRequestThen(res, 'DELETE', `/permissions?${FOLDERS}${id}`, lib.flowThroughHeaders(req), null, function (clientRes) {
        lib.getClientResponseBody(clientRes, function(body) {
          var statusCode = clientRes.statusCode
          if (statusCode !== 200)
            console.log(`unable to delete permissions for ${FOLDERS}${id}`)
        })
      })
      folder.self = makeSelfURL(req, id)
      addCalculatedProperties(folder)
      rLib.found(res, folder, req.headers.accept, folder.self, etag)
    })
  })
}

function updateFolder(req, res, id, patch) {
  pLib.ifAllowedThen(req, res, null, '_self', 'update', function() {
    db.withFolderDo(req, res, id, function(folder , etag) {
      lib.applyPatch(req, res, folder, patch, function(patchedFolder) {
        db.updateFolderThen(req, res, id, folder, patchedFolder, etag, function (etag) {
          patchedFolder.self = makeSelfURL(req, id) 
          addCalculatedProperties(patchedFolder)
          rLib.found(res, patchedFolder, req.headers.accept, patchedFolder.self, etag)
        })
      })
    })
  })
}

function getFoldersForUser(req, res, user) {
  var requestingUser = lib.getUser(req.headers.authorization)
  user = lib.internalizeURL(user, req.headers.host)
  if (user == requestingUser) {
    db.withFoldersForUserDo(req, res, user, function (folderIDs) {
      var rslt = {
        self: req.url,
        contents: folderIDs.map(id => `//${req.headers.host}${FOLDERS}${id}`)
      }
      rLib.found(res, rslt, req.headers.accept, rslt.self)
    })
  } else
    rLib.forbidden(res, `One user may not request another's folders. Requesting user: ${requestingUser} target user: ${user}`)
}

function requestHandler(req, res) {
  if (req.url == '/folders') 
    if (req.method == 'POST') 
      lib.getServerPostObject(req, res, (t) => createFolder(req, res, t))
    else 
      rLib.methodNotAllowed(res, ['POST'])
  else {
    var req_url = url.parse(req.url)
    if (req_url.pathname.startsWith(FOLDERS)) {
      var id = req_url.pathname.substring(FOLDERS.length)
      if (req.method == 'GET')
        getFolder(req, res, id)
      else if (req.method == 'DELETE') 
        deleteFolder(req, res, id)
      else if (req.method == 'PATCH') 
        lib.getServerPostObject(req, res, (jso) => updateFolder(req, res, id, jso))
      else
        rLib.methodNotAllowed(res, ['GET', 'DELETE', 'PATCH'])
    } else 
      rLib.notFound(res, `//${req.headers.host}${req.url} not found`)
  }
}

function start(){
  db.init(function(){
    var port = process.env.PORT
    http.createServer(requestHandler).listen(port, function() {
      console.log(`server is listening on ${port}`)
    })
  })
}

if (process.env.INTERNAL_SY_ROUTER_HOST == 'kubernetes_host_ip') 
  lib.getHostIPThen(function(err, hostIP){
    if (err) 
      process.exit(1)
    else {
      process.env.INTERNAL_SY_ROUTER_HOST = hostIP
      start()
    }
  })
else 
  start()
