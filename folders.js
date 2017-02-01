'use strict'
const http = require('http')
const url = require('url')
const lib = require('http-helper-functions')
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
      lib.badRequest(res, err) 
    else {
      var id = lib.uuid4()
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
          lib.created(req, res, folder, folder.self, etag)
        })
      })
    }
  })
}

function makeSelfURL(req, key) {
  return 'scheme://authority' + FOLDERS + key
}

function addCalculatedProperties(folder) {
  var externalSelf = lib.externalizeURLs(folder.self)
  folder._permissions = `scheme://authority/permissions?${externalSelf}`
  folder._permissionsHeirs = `scheme://authority/permissions-heirs?${externalSelf}`  
}

function getFolder(req, res, id) {
  pLib.ifAllowedThen(req, res, null, '_self', 'read', function(err, reason) {
    db.withFolderDo(req, res, id, function(folder , etag) {
      folder.self = makeSelfURL(req, id)
      addCalculatedProperties(folder)
      lib.externalizeURLs(folder, req.headers.host)
      lib.found(req, res, folder, etag)
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
      addCalculatedProperties(folder)
      lib.found(req, res, folder, etag)
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
          lib.found(req, res, patchedFolder, etag)
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
        self: `scheme://authority${req.url}`,
        contents: folderIDs.map(id => `//${req.headers.host}${FOLDERS}${id}`)
      }
      lib.externalizeURLs(rslt)
      lib.found(req, res, rslt)
    })
  } else
    lib.forbidden(req, res)
}

function requestHandler(req, res) {
  if (req.url == '/folders') 
    if (req.method == 'POST') 
      lib.getServerPostObject(req, res, (t) => createFolder(req, res, t))
    else 
      lib.methodNotAllowed(req, res, ['POST'])
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
        lib.methodNotAllowed(req, res, ['GET', 'DELETE', 'PATCH'])
    } else 
      lib.notFound(req, res)
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
