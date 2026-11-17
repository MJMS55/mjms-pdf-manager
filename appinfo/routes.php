<?php
return [
    "routes" => [
        ["name" => "file#source", "url" => "/api/source", "verb" => "GET"],
        ["name" => "mail#send", "url" => "/api/mail", "verb" => "POST"],
        ["name" => "page#index", "url" => "/", "verb" => "GET"],
        ["name" => "file#list", "url" => "/api/files", "verb" => "GET"],
        ["name" => "file#read", "url" => "/api/pdf", "verb" => "GET"],
        ["name" => "file#save", "url" => "/api/pdf", "verb" => "POST"],
    ],
];
